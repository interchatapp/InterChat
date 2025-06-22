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

import { ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, type Client } from 'discord.js';
import type { INotificationService } from '../core/interfaces.js';
import type { ActiveCall } from '../core/types.js';
import { BroadcastService } from '#src/services/BroadcastService.js';
import Logger from '#src/utils/Logger.js';
import { CustomID } from '#src/utils/CustomID.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { getRedis } from '#src/utils/Redis.js';
import type { Redis } from 'ioredis';

/**
 * Simplified notification service for essential call events only
 */
export class NotificationService implements INotificationService {
  private readonly client: Client;
  private readonly redis: Redis;
  private readonly ui: UIComponents;
  private readonly rateLimitWindow = 60000; // 1 minute
  private readonly maxNotificationsPerWindow = 5; // Reduced limit

  constructor(client: Client) {
    this.client = client;
    this.redis = getRedis();
    this.ui = new UIComponents(client);
  }

  /**
   * Simplified rate limiting
   */
  private async checkRateLimit(channelId: string): Promise<boolean> {
    try {
      const key = `call:notifications:${channelId}`;
      const current = await this.redis.incr(key);

      if (current === 1) {
        await this.redis.expire(key, Math.ceil(this.rateLimitWindow / 1000));
      }

      return current <= this.maxNotificationsPerWindow;
    }
    catch (error) {
      Logger.error(`Error checking rate limit for channel ${channelId}:`, error);
      return true; // Allow on error
    }
  }

  /**
   * Simplified call match notification - only essential message
   */
  async notifyCallMatched(channelId: string, call: ActiveCall): Promise<void> {
    try {
      if (!(await this.checkRateLimit(channelId))) {
        return;
      }

      const participant = call.participants.find((p) => p.channelId === channelId);
      if (!participant) {
        return;
      }

      // Simple notification with essential controls only
      const container = new ContainerBuilder();

      container.addTextDisplayComponents(
        this.ui.createCompactHeader(
          'Call Connected!',
          'You\'re now connected to another server. Say hello! 👋',
          'call_icon',
        ),
      );

      // Essential controls only
      container.addActionRowComponents((row) =>
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(new CustomID().setIdentifier('call', 'hangup').toString())
            .setLabel('End Call')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('📞'),
          new ButtonBuilder()
            .setCustomId(new CustomID().setIdentifier('call', 'skip').toString())
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⏭️'),
        ),
      );

      await this.sendMessage(participant.webhookUrl, container);
      Logger.debug(`Call match notification sent to channel ${channelId}`);
    }
    catch (error) {
      Logger.error(`Error notifying call match for channel ${channelId}:`, error);
    }
  }

  /**
   * Send message with UI components via webhook
   */
  private async sendMessage(
    webhookUrl: string,
    container: ContainerBuilder,
  ): Promise<void> {
    try {
      Logger.debug(`Attempting to send message to webhook: ${webhookUrl.substring(0, 50)}...`);

      const result = await BroadcastService.sendMessage(webhookUrl, {
        components: [container], flags: [MessageFlags.IsComponentsV2],
      });

      if (result.error) {
        Logger.error(`Error sending message via webhook: ${result.error}`);
        Logger.error(`Webhook URL: ${webhookUrl.substring(0, 50)}...`);
      }
      else {
        Logger.debug('Successfully sent message via webhook');
      }
    }
    catch (error) {
      Logger.error('Error sending message:', error);
      Logger.error(`Webhook URL: ${webhookUrl.substring(0, 50)}...`);
    }
  }

  /**
   * Simplified call end notification
   */
  async notifyCallEnded(
    channelId: string,
    _callId: string,
    duration?: number,
    messageCount?: number,
  ): Promise<void> {
    try {
      if (!(await this.checkRateLimit(channelId))) {
        return;
      }

      const channel = this.client.channels.cache.get(channelId);
      if (!channel || !channel.isSendable() || !('send' in channel)) {
        return;
      }

      const container = new ContainerBuilder();

      // Simple end message with basic stats
      let description = 'Thanks for using InterChat! 🎉';
      if (duration && messageCount !== undefined) {
        const durationMinutes = Math.floor(duration / 60000);
        const durationSeconds = Math.floor((duration % 60000) / 1000);
        description += `\n⏱️ ${durationMinutes}m ${durationSeconds}s • 💬 ${messageCount} messages`;
      }

      container.addTextDisplayComponents(
        this.ui.createCompactHeader('Call Ended', description, 'hangup_icon'),
      );

      // Single action button
      container.addActionRowComponents((row) =>
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(new CustomID().setIdentifier('call', 'new-call').toString())
            .setLabel('New Call')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📞'),
        ),
      );

      await channel.send({ components: [container], flags: [MessageFlags.IsComponentsV2] });
      Logger.debug(`Call end notification sent to channel ${channelId}`);
    }
    catch (error) {
      Logger.error(`Error notifying call end for channel ${channelId}:`, error);
    }
  }

  /**
   * Simplified call started notification - removed as redundant with match notification
   */
  async notifyCallStarted(_channelId: string, _call: ActiveCall): Promise<void> {
    // Removed - redundant with notifyCallMatched
    // This reduces notification spam as requested
  }


  /**
   * Simplified timeout notification
   */
  async notifyCallTimeout(channelId: string): Promise<void> {
    try {
      if (!(await this.checkRateLimit(channelId))) {
        return;
      }

      const channel = this.client.channels.cache.get(channelId);
      if (!channel || !channel.isSendable() || !('send' in channel)) {
        return;
      }

      const container = new ContainerBuilder();

      container.addTextDisplayComponents(
        this.ui.createCompactHeader(
          'No Match Found',
          '⏰ Try again or explore hubs for more connections!',
          'clock_icon',
        ),
      );

      container.addActionRowComponents((row) =>
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(new CustomID().setIdentifier('call', 'retry').toString())
            .setLabel('Try Again')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔄'),
        ),
      );

      await channel.send({ components: [container], flags: [MessageFlags.IsComponentsV2] });
      Logger.debug(`Timeout notification sent to channel ${channelId}`);
    }
    catch (error) {
      Logger.error(`Error notifying call timeout for channel ${channelId}:`, error);
    }
  }

  /**
   * Simplified connection error notification
   */
  async notifyConnectionError(
    channelId: string,
    _errorType: string,
    retryable = true,
  ): Promise<void> {
    try {
      if (!(await this.checkRateLimit(channelId))) {
        return;
      }

      const channel = this.client.channels.cache.get(channelId);
      if (!channel || !channel.isSendable() || !('send' in channel)) {
        return;
      }

      const container = new ContainerBuilder();

      container.addTextDisplayComponents(
        this.ui.createCompactHeader('Connection Error', '❌ Please try again', 'dotRed'),
      );

      if (retryable) {
        container.addActionRowComponents((row) =>
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(new CustomID().setIdentifier('call', 'retry').toString())
              .setLabel('Try Again')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('🔄'),
          ),
        );
      }

      await channel.send({ components: [container], flags: [MessageFlags.IsComponentsV2] });
      Logger.debug(`Connection error notification sent to channel ${channelId}`);
    }
    catch (error) {
      Logger.error(`Error notifying connection error for channel ${channelId}:`, error);
    }
  }

  /**
   * Simplified participant notifications - removed to reduce spam
   */
  async notifyParticipantJoined(
    _webhookUrl: string,
    _username: string,
    _guildName?: string,
  ): Promise<void> {
    // Removed to reduce notification spam
  }

  async notifyParticipantLeft(
    _webhookUrl: string,
    _username: string,
    _guildName?: string,
  ): Promise<void> {
    // Removed to reduce notification spam
  }

  /**
   * Essential system message functionality
   */
  async sendSystemMessage(
    webhookUrl: string,
    content: string,
    components?: unknown[],
  ): Promise<void> {
    try {
      const result = await BroadcastService.sendMessage(webhookUrl, {
        content,
        components: (components as never[]) || [],
      });

      if (result.error) {
        Logger.error(`Error sending system message via webhook: ${result.error}`);
      }
    }
    catch (error) {
      Logger.error('Error sending system message:', error);
    }
  }
}
