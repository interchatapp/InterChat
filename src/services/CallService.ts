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

interface CallData {
  callId: string;
  channelId: string;
  guildId: string;
  initiatorId: string;
  webhookUrl: string;
  timestamp: number;
}

interface CallParticipants {
  channelId: string;
  guildId: string;
  webhookUrl: string;
  users: Set<string>;
}

interface ActiveCallData {
  callId: string;
  participants: CallParticipants[];
}

export class CallService {
  private readonly redis = getRedis();
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
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

  async initiateCall(
    channel: GuildTextBasedChannel,
    initiatorId: string,
  ): Promise<{ success: boolean; message: string }> {
    // Check if channel is already in a call
    const activeCall = await this.redis.get(this.getActiveCallKey(channel.id));
    if (activeCall) {
      return { success: false, message: 'This channel is already in a call!' };
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
    success: boolean;
    message: string;
    components?: ActionRowBuilder<ButtonBuilder>[];
  }> {
    const activeCall = await this.getActiveCallData(channelId);

    if (!activeCall) {
      // Check if in queue
      const queue = await this.redis.lrange(this.getQueueKey(), 0, -1);
      const inQueue = queue.some((item) => JSON.parse(item).channelId === channelId);

      if (inQueue) {
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

    // Store call data temporarily for ratings
    await this.redis.set(
      `${RedisKeys.Call}:ended:${activeCall.callId}`,
      JSON.stringify(activeCall, (_, value) => (value instanceof Set ? Array.from(value) : value)),
      'EX',
      3600, // 1 hour to rate the call
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
      success: true,
      message: content,
      components,
    };
  }

  async skip(channelId: string): Promise<{ success: boolean; message: string }> {
    const result = await this.hangup(channelId);
    if (!result.success) {
      return result;
    }

    // Initiate new call
    const channel = (await this.client.channels.fetch(channelId)) as TextChannel;
    return this.initiateCall(channel, channel.guild.id);
  }

  private async tryMatch(callData: CallData): Promise<boolean> {
    const queue = await this.redis.lrange(this.getQueueKey(), 0, -1);

    for (const queuedCallStr of queue) {
      const queuedCall: CallData = JSON.parse(queuedCallStr);

      // Don't match with self or same server
      if (queuedCall.guildId === callData.guildId) continue;

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

    // Update leaderboards for both users and servers
    await Promise.all([
      updateCallLeaderboards('user', call1.initiatorId),
      updateCallLeaderboards('user', call2.initiatorId),
      updateCallLeaderboards('server', call1.guildId),
      updateCallLeaderboards('server', call2.guildId),
    ]);

    const activeCallData: ActiveCallData = {
      callId,
      participants: [
        {
          channelId: call1.channelId,
          guildId: call1.guildId,
          webhookUrl: call1.webhookUrl,
          users: new Set([call1.initiatorId]),
        },
        {
          channelId: call2.channelId,
          guildId: call2.guildId,
          webhookUrl: call2.webhookUrl,
          users: new Set([call2.initiatorId]),
        },
      ],
    };

    // Store the same data for both channels
    await Promise.all([
      this.redis.set(
        this.getActiveCallKey(call1.channelId),
        JSON.stringify(activeCallData, (_, value) =>
          value instanceof Set ? Array.from(value) : value,
        ),
        'EX',
        3600,
      ),
      this.redis.set(
        this.getActiveCallKey(call2.channelId),
        JSON.stringify(activeCallData, (_, value) =>
          value instanceof Set ? Array.from(value) : value,
        ),
        'EX',
        3600,
      ),
    ]);

    // Send connected messages to both channels
    const message = await this.getCallStartMessage();
    await this.sendSystemMessage(call2.webhookUrl, message);
    await this.sendSystemMessage(call1.webhookUrl, message);
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
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID('rate_call:like', [callId]).toString())
        .setLabel('👍 Like')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(new CustomID('rate_call:dislike', [callId]).toString())
        .setLabel('👎 Dislike')
        .setStyle(ButtonStyle.Danger),
    );

    return {
      content: '**Call ended!** How was your experience?',
      components: [row],
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
    });
  }
}
