/*
 * Copyright (C) 2025 InterChat
 *
 * InterChat is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * InterChat is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with InterChat.  If not, see <https://www.gnu.org/licenses/>.
 */

import { BroadcastService } from '#src/services/BroadcastService.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { getOrCreateWebhook } from '#src/utils/Utils.js';
import Constants, { RedisKeys } from '#utils/Constants.js';
import { getRedis } from '#utils/Redis.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GuildTextBasedChannel,
  type TextChannel,
} from 'discord.js';
import { updateCallLeaderboards } from '#src/utils/Leaderboard.js';

export interface CallData {
  callId: string;
  channelId: string;
  guildId: string;
  initiatorId: string;
  webhookUrl: string;
  timestamp: number;
}

export interface CallParticipants {
  channelId: string;
  guildId: string;
  webhookUrl: string;
  users: Set<string>;
  messageCount: number;
  leaderboardUpdated: boolean; // to track if we've already counted this call
}

export interface CallMessage {
  authorId: string;
  content: string;
  timestamp: number;
  attachmentUrl?: string;
}

export interface ActiveCallData {
  callId: string;
  participants: CallParticipants[];
  messages?: CallMessage[];
  startTime?: number;
  endTime?: number;
}

const MINIMUM_MESSAGES_FOR_CALL = 3;

export class CallService {
  private readonly redis = getRedis();
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  private async addRecentMatch(userId1: string, userId2: string) {
    const key1 = `${RedisKeys.CallRecentMatches}:${userId1}`;
    const key2 = `${RedisKeys.CallRecentMatches}:${userId2}`;

    // Store for both users
    await Promise.all([
      this.redis.lpush(key1, userId2),
      this.redis.lpush(key2, userId1),
      // Trim to keep only last 3 matches
      this.redis.ltrim(key1, 0, 2),
      this.redis.ltrim(key2, 0, 2),
      // Set expiry (24 hours)
      this.redis.expire(key1, 24 * 60 * 60),
      this.redis.expire(key2, 24 * 60 * 60),
    ]);
  }

  private async hasRecentlyMatched(userId1: string, userId2: string): Promise<boolean> {
    const key = `${RedisKeys.CallRecentMatches}:${userId1}`;
    const recentMatches = await this.redis.lrange(key, 0, 2); // Get last 3 matches
    return recentMatches.includes(userId2);
  }

  private getQueueKey() {
    return `${RedisKeys.Call}:queue`;
  }

  private getActiveCallKey(channelId: string) {
    return `${RedisKeys.Call}:active:${channelId}`;
  }

  private generateCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Check if a channel is already in the call queue
   * @param channelId The channel ID to check
   * @returns True if the channel is in the queue, false otherwise
   */
  private async isChannelInQueue(channelId: string): Promise<boolean> {
    const queue = await this.redis.lrange(this.getQueueKey(), 0, -1);
    return queue.some((item) => JSON.parse(item).channelId === channelId);
  }

  async initiateCall(
    channel: GuildTextBasedChannel,
    initiatorId: string,
  ): Promise<{ success: boolean; message: string }> {
    // Check if channel is already in a call
    const activeCall = await this.redis.get(this.getActiveCallKey(channel.id));
    if (activeCall) {
      return { success: false, message: 'This channel is already in a call!' };
    }

    // Check if channel is already in the queue
    const inQueue = await this.isChannelInQueue(channel.id);
    if (inQueue) {
      return { success: false, message: 'This channel is already in the call queue!' };
    }

    // Create webhook for the channel
    const webhook = await getOrCreateWebhook(
      channel,
      channel.client.user.displayAvatarURL(),
      'Call System',
    ).catch(() => null);

    if (!webhook) {
      return { success: false, message: 'Failed to create webhook. Please try again later.' };
    }

    const callData: CallData = {
      callId: this.generateCallId(),
      channelId: channel.id,
      guildId: channel.guildId,
      initiatorId,
      webhookUrl: webhook.url,
      timestamp: Date.now(),
    };

    // Add to queue
    await this.redis.rpush(this.getQueueKey(), JSON.stringify(callData));

    // Try to match immediately
    const matched = await this.tryMatch(callData);
    if (!matched) {
      const waitEmoji = getEmoji('clock_icon', this.client);
      return {
        success: true,
        message: `${waitEmoji} Added to call queue. Waiting for another server to join...`,
      };
    }

    return { success: true, message: 'Call connected!' };
  }

  async hangup(channelId: string): Promise<{
    callId?: string;
    success: boolean;
    message: string;
    components?: ActionRowBuilder<ButtonBuilder>[];
  }> {
    const activeCall = await this.getActiveCallData(channelId);

    if (!activeCall) {
      // Check if in queue
      const inQueue = await this.isChannelInQueue(channelId);

      if (inQueue) {
        // Get the queue to find the exact item to remove
        const queue = await this.redis.lrange(this.getQueueKey(), 0, -1);
        await this.redis.lrem(
          this.getQueueKey(),
          0,
          queue.find((item) => JSON.parse(item).channelId === channelId)!,
        );
        return {
          success: true,
          message:
            '✅ Removed from call queue. You can start a new call with `/call` whenever you\'re ready!',
        };
      }

      return {
        success: false,
        message: '❌ This channel isn\'t in an active call. Use `/call` to start one!',
      };
    }

    const { content, components } = await this.getCallEndMessage(activeCall.callId);

    // Set end time
    activeCall.endTime = Date.now();

    // Check if this call has been reported
    const reportKey = `${RedisKeys.Call}:report:${activeCall.callId}`;
    const hasBeenReported = await this.redis.exists(reportKey);

    // Determine expiry time based on whether the call has been reported
    // For privacy reasons, we keep different retention periods:
    // - 30 minutes (1800 seconds) for normal calls
    // - 48 hours (172800 seconds) for reported calls to allow for moderation
    const expiryTime = hasBeenReported ? 172800 : 1800;

    // Store call data temporarily
    await this.redis.set(
      `${RedisKeys.Call}:ended:${activeCall.callId}`,
      JSON.stringify(activeCall, (_, value) => (value instanceof Set ? Array.from(value) : value)),
      'EX',
      expiryTime,
    );

    // Find the other participant and send them the end message
    const otherParticipant = activeCall.participants.find((p) => p.channelId !== channelId);
    if (otherParticipant) {
      await this.sendSystemMessage(otherParticipant.webhookUrl, content, components);
    }

    // Remove both channels from active calls
    await Promise.all(
      activeCall.participants.map((p) => this.redis.del(this.getActiveCallKey(p.channelId))),
    );

    // Return message for the channel that initiated the hangup
    return {
      callId: activeCall.callId,
      success: true,
      message: content,
      components,
    };
  }

  /**
   * Skip the current call and find a new match
   * @param channelId The channel ID to skip the call in
   * @param userId The user ID who initiated the skip
   * @returns Result of the operation
   */
  async skip(channelId: string, userId: string): Promise<{ success: boolean; message: string }> {
    // First hang up the current call
    const hangupResult = await this.hangup(channelId);
    if (!hangupResult.success) {
      return hangupResult;
    }

    // Then initiate a new call with the user who initiated the skip
    const channel = (await this.client.channels.fetch(channelId)) as TextChannel;
    return this.initiateCall(channel, userId);
  }

  private async tryMatch(callData: CallData): Promise<boolean> {
    const queue = await this.redis.lrange(this.getQueueKey(), 0, -1);

    for (const queuedCallStr of queue) {
      const queuedCall: CallData = JSON.parse(queuedCallStr);

      // Don't match if:
      // 1. Same server
      // 2. Same initiator
      // 3. Recently matched
      if (
        queuedCall.guildId === callData.guildId ||
        queuedCall.initiatorId === callData.initiatorId ||
        (await this.hasRecentlyMatched(callData.initiatorId, queuedCall.initiatorId))
      ) {
        continue;
      }

      // Found a match!
      await this.connectCall(callData, queuedCall);

      // Remove both from queue
      await this.redis.lrem(this.getQueueKey(), 0, queuedCallStr);
      await this.redis.lrem(this.getQueueKey(), 0, JSON.stringify(callData));

      return true;
    }

    return false;
  }

  private async connectCall(call1: CallData, call2: CallData) {
    const callId = this.generateCallId();
    const startTime = Date.now();

    // Store recent match
    await this.addRecentMatch(call1.initiatorId, call2.initiatorId);

    // Initialize call data without updating leaderboards yet
    const activeCallData: ActiveCallData = {
      callId,
      participants: [
        {
          channelId: call1.channelId,
          guildId: call1.guildId,
          webhookUrl: call1.webhookUrl,
          users: new Set([call1.initiatorId]),
          messageCount: 0,
          leaderboardUpdated: false,
        },
        {
          channelId: call2.channelId,
          guildId: call2.guildId,
          webhookUrl: call2.webhookUrl,
          users: new Set([call2.initiatorId]),
          messageCount: 0,
          leaderboardUpdated: false,
        },
      ],
      messages: [],
      startTime,
    };

    // Store active call data
    await Promise.all([
      this.redis.set(
        this.getActiveCallKey(call1.channelId),
        JSON.stringify(activeCallData, (_, value) =>
          value instanceof Set ? Array.from(value) : value,
        ),
      ),
      this.redis.set(
        this.getActiveCallKey(call2.channelId),
        JSON.stringify(activeCallData, (_, value) =>
          value instanceof Set ? Array.from(value) : value,
        ),
      ),
    ]);

    // Send connected messages to both channels with pings for the initiators
    const message = await this.getCallStartMessage();
    await this.sendSystemMessage(call2.webhookUrl, `<@${call2.initiatorId}> ${message}`);
    await this.sendSystemMessage(call1.webhookUrl, `<@${call1.initiatorId}> ${message}`);
  }

  // Add method to track new participants during the call
  async addParticipant(channelId: string, userId: string) {
    const callData = await this.getActiveCallData(channelId);
    if (!callData) return false;

    const participant = callData.participants.find((p) => p.channelId === channelId);
    if (!participant) return false;

    // Only update leaderboard if this is a new participant
    if (!participant.users.has(userId)) {
      const guildId = participant.guildId;
      await Promise.all([
        updateCallLeaderboards('user', userId),
        updateCallLeaderboards('server', guildId),
      ]);
    }

    participant.users.add(userId);

    // Update the stored call data
    await this.redis.set(
      this.getActiveCallKey(channelId),
      JSON.stringify(callData, (_, value) => (value instanceof Set ? Array.from(value) : value)),
      'EX',
      3600,
    );

    return true;
  }

  public async getActiveCallData(channelId: string): Promise<ActiveCallData | null> {
    const data = await this.redis.get(this.getActiveCallKey(channelId));
    if (!data) return null;

    const parsed = JSON.parse(data) as ActiveCallData;
    // Convert arrays back to Sets
    parsed.participants.forEach((p) => {
      p.users = new Set(p.users);
    });
    return parsed;
  }

  // Add this new method to get ended call data
  async getEndedCallData(callId: string): Promise<ActiveCallData | null> {
    const data = await this.redis.get(`${RedisKeys.Call}:ended:${callId}`);
    if (!data) return null;

    const parsed = JSON.parse(data) as ActiveCallData;
    // Convert arrays back to Sets
    parsed.participants.forEach((p) => {
      p.users = new Set(p.users as unknown as string[]);
    });
    return parsed;
  }

  private async getCallStartMessage() {
    const callEmoji = getEmoji('call_icon', this.client);
    const content = stripIndents`${callEmoji} **Call Connected!**
      > - You can now chat with the other server
      > - Use \`/hangup\` to end the call
      > - Keep conversations friendly and follow our [guidelines](${Constants.Links.Website}/guidelines).`;

    return content;
  }

  private async getCallEndMessage(callId: string) {
    const ratingRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID('rate_call:like', [callId]).toString())
        .setLabel('👍 Like')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(new CustomID('rate_call:dislike', [callId]).toString())
        .setLabel('👎 Dislike')
        .setStyle(ButtonStyle.Danger),
    );

    const reportRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID('report_call', [callId]).toString())
        .setLabel('🚩 Report')
        .setStyle(ButtonStyle.Secondary),
    );

    return {
      content: '**Call ended!** How was your experience?',
      components: [ratingRow, reportRow],
    };
  }

  private async sendSystemMessage(
    webhookUrl: string,
    content: string,
    components: ActionRowBuilder<ButtonBuilder>[] = [],
  ) {
    await BroadcastService.sendMessage(webhookUrl, {
      content,
      username: 'InterChat Calls',
      avatarURL: this.client.user?.displayAvatarURL(),
      components: components.map((c) => c.toJSON()),
      allowedMentions: { parse: ['users'] },
    });
  }

  // handle message counting and leaderboard updates
  async updateCallParticipant(
    channelId: string,
    userId: string,
    messageContent?: string,
    attachmentUrl?: string,
  ): Promise<void> {
    const callData = await this.getActiveCallData(channelId);
    if (!callData) return;

    const participant = callData.participants.find((p) => p.channelId === channelId);
    if (!participant) return;

    // Increment message count
    participant.messageCount++;

    // Check if we should update leaderboards
    if (!participant.leaderboardUpdated && participant.messageCount >= MINIMUM_MESSAGES_FOR_CALL) {
      participant.leaderboardUpdated = true;

      // Update leaderboards for both the user and the server
      await Promise.all([
        updateCallLeaderboards('user', userId),
        updateCallLeaderboards('server', participant.guildId),
      ]);
    }

    // Store message content if provided (for moderation purposes)
    if (messageContent !== undefined) {
      if (!callData.messages) {
        callData.messages = [];
      }

      // Add message to the array (limit to last 100 messages)
      callData.messages.push({
        authorId: userId,
        content: messageContent,
        timestamp: Date.now(),
        attachmentUrl,
      });

      // Keep only the last 100 messages to prevent excessive storage
      if (callData.messages.length > 100) {
        callData.messages = callData.messages.slice(-100);
      }
    }

    // Update the call data in Redis
    await Promise.all(
      callData.participants.map((p) =>
        this.redis.set(
          this.getActiveCallKey(p.channelId),
          JSON.stringify(callData, (_, value) =>
            value instanceof Set ? Array.from(value) : value,
          ),
          'EX',
          3600,
        ),
      ),
    );
  }
}
