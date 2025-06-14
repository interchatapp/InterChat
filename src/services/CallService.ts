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

import AchievementService from '#src/services/AchievementService.js';
import { BroadcastService } from '#src/services/BroadcastService.js';
import { CallDatabaseService } from '#src/services/CallDatabaseService.js';
import { CallReplyService } from '#src/services/CallReplyService.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { updateCallLeaderboards } from '#src/utils/Leaderboard.js';
import { t } from '#src/utils/Locale.js';
import { getOrCreateWebhook } from '#src/utils/Utils.js';
import Constants, { RedisKeys } from '#utils/Constants.js';
import Logger from '#utils/Logger.js';
import { getRedis } from '#utils/Redis.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GuildTextBasedChannel,
  type TextChannel,
} from 'discord.js';

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
  authorUsername: string;
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
  private readonly achievementService: AchievementService;
  private readonly callDbService: CallDatabaseService;
  private readonly callReplyService: CallReplyService;

  constructor(client: Client) {
    this.client = client;
    this.achievementService = new AchievementService();
    this.callDbService = new CallDatabaseService();
    this.callReplyService = new CallReplyService();
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
    const recentMatches = await this.redis.lrange(key, 0, 0); // Get last 1 match (initially, because there's less users)
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
            "✅ Removed from call queue. You can start a new call with `/call` whenever you're ready!",
        };
      }

      return {
        success: false,
        message: "❌ This channel isn't in an active call. Use `/call` to start one!",
      };
    }

    const { content, components } = await this.getCallEndMessage(activeCall.callId);

    // Set end time
    activeCall.endTime = Date.now();

    // Calculate call duration and participant count for achievements
    const duration = activeCall.startTime
      ? Math.floor((activeCall.endTime - activeCall.startTime) / 1000)
      : 0;
    const allParticipants = new Set<string>();
    activeCall.participants.forEach((p) => p.users.forEach((u) => allParticipants.add(u)));
    const participantCount = allParticipants.size;

    // Track call end achievements for all participants
    const achievementPromises = Array.from(allParticipants).map((userId) => {
      // Find which channel this user was in for proper notification
      const userChannel = activeCall.participants.find((p) => p.users.has(userId))?.channelId;
      return this.achievementService.processEvent(
        'call_end',
        {
          userId,
          callId: activeCall.callId,
          duration,
          participantCount,
        },
        this.client,
        userChannel,
      );
    });
    await Promise.all(achievementPromises);

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

    // Remove both channels from active calls using pipeline
    const pipeline = this.redis.pipeline();
    activeCall.participants.forEach((p) => {
      pipeline.del(this.getActiveCallKey(p.channelId));
    });
    await pipeline.exec();

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

    // Get channel from cache first, then fetch if needed
    let channel = this.client.channels.cache.get(channelId) as TextChannel;
    if (!channel) {
      channel = (await this.client.channels.fetch(channelId)) as TextChannel;
    }

    return this.initiateCall(channel, userId);
  }

  private async tryMatch(callData: CallData): Promise<boolean> {
    const queue = await this.redis.lrange(this.getQueueKey(), 0, -1);

    for (const queuedCallStr of queue) {
      const queuedCall: CallData = JSON.parse(queuedCallStr);

      // Don't match if:
      // 1. Same server
      // 2. Same initiator
      // 3. Recently matched (COMMENTED OUT FOR INITIAL DAYS)
      if (
        queuedCall.guildId === callData.guildId ||
        queuedCall.initiatorId === callData.initiatorId ||
        (await this.hasRecentlyMatched(callData.initiatorId, queuedCall.initiatorId))
      ) {
        continue;
      }

      // Found a match!
      await this.connectCall(callData, queuedCall);

      // Remove both from queue using pipeline for better performance
      const pipeline = this.redis.pipeline();
      pipeline.lrem(this.getQueueKey(), 0, queuedCallStr);
      pipeline.lrem(this.getQueueKey(), 0, JSON.stringify(callData));
      await pipeline.exec();

      return true;
    }

    return false;
  }

  private async connectCall(call1: CallData, call2: CallData) {
    const startTime = Date.now();

    // Store recent match
    await this.addRecentMatch(call1.initiatorId, call2.initiatorId);

    // Create the call in the database with participants in a single transaction
    let dbCall;
    try {
      dbCall = await this.callDbService.createCall(call1.initiatorId);

      // Batch the status update and participant creation for better performance
      await Promise.all([
        this.callDbService.updateCallStatus(dbCall.id, 'ACTIVE'),
        this.callDbService.addParticipant(
          dbCall.id,
          call1.channelId,
          call1.guildId,
          call1.webhookUrl,
        ),
        this.callDbService.addParticipant(
          dbCall.id,
          call2.channelId,
          call2.guildId,
          call2.webhookUrl,
        ),
      ]);
    }
    catch (error) {
      Logger.error('Failed to create call in database:', error);
      // Fall back to generated ID if database creation fails
      dbCall = { id: this.generateCallId() };
    }

    const callId = dbCall.id;

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

    // Track call start achievements for both initiators
    Promise.all([
      this.achievementService.processEvent(
        'call_start',
        {
          userId: call1.initiatorId,
          callId,
        },
        this.client,
        call1.channelId,
      ),
      this.achievementService.processEvent(
        'call_start',
        {
          userId: call2.initiatorId,
          callId,
        },
        this.client,
        call2.channelId,
      ),
    ]);
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
    // Use default locale for system messages - could be enhanced to use user's locale
    const content = t('calls.system.callStart', 'en', {
      emoji: callEmoji,
      guidelines: `<${Constants.Links.Website}/guidelines>`,
    });

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
      content:
        '**Call ended!** 👋 Thanks for connecting with another community! How was your experience? Your feedback helps us make InterChat even better!',
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
    username: string,
    messageContent?: string,
    attachmentUrl?: string,
  ): Promise<void> {
    const callData = await this.getActiveCallData(channelId);
    if (!callData) return;

    const participant = callData.participants.find((p) => p.channelId === channelId);
    if (!participant) return;

    // Increment message count
    participant.messageCount++;

    // Track call message achievements
    await this.achievementService.processEvent(
      'call_message',
      {
        userId,
        callId: callData.callId,
        messageCount: participant.messageCount,
      },
      this.client,
      channelId,
    );

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
        authorUsername: username,
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
