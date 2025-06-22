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

import type { GuildTextBasedChannel, Client } from 'discord.js';
import type {
  ICallManager,
  IQueueManager,
  ICacheManager,
  ICallRepository,
  INotificationService,
  ICallMetrics,
} from '../core/interfaces.js';
import type { CallResult, ActiveCall, CallRequest } from '../core/types.js';
import { CallEventHandler } from '../core/events.js';
import { getOrCreateWebhook, handleError } from '#src/utils/Utils.js';
import Logger from '#src/utils/Logger.js';
import { DistributedStateManager } from '#src/lib/userphone/distributed/DistributedStateManager.js';

/**
 * Main call management service
 * Orchestrates call lifecycle operations
 */
export class CallManager extends CallEventHandler implements ICallManager {
  private readonly queueManager: IQueueManager;
  private readonly cacheManager: ICacheManager;
  private readonly repository: ICallRepository;
  private readonly notificationService: INotificationService;
  private readonly metrics: ICallMetrics;
  private readonly stateManager?: DistributedStateManager; // Optional distributed state manager
  private readonly client: Client;

  constructor(
    queueManager: IQueueManager,
    cacheManager: ICacheManager,
    repository: ICallRepository,
    notificationService: INotificationService,
    metrics: ICallMetrics,
    client: Client,
    stateManager?: DistributedStateManager,
  ) {
    super();
    this.queueManager = queueManager;
    this.cacheManager = cacheManager;
    this.repository = repository;
    this.notificationService = notificationService;
    this.metrics = metrics;
    this.client = client;
    this.stateManager = stateManager;
  }

  protected setupEventListeners(): void {
    // Listen for call events to update state
    this.subscribe('call:matched', async (data) => {
      // Cache the active call
      await this.cacheManager.cacheActiveCall(data.call);

      // Send enhanced match notifications to all participants
      for (const participant of data.call.participants) {
        await this.notificationService.notifyCallMatched(participant.channelId, data.call);
      }

      // Emit call:started event for other systems to listen to (no redundant notifications)
      this.emit('call:started', { call: data.call });
    });

    this.subscribe('call:ended', async (data) => {
      // Remove from cache
      for (const participant of data.call.participants) {
        await this.cacheManager.removeActiveCall(participant.channelId);
      }
    });

    // Listen for participant events to send notifications
    this.subscribe('call:participant-joined', async (data) => {
      const call = await this.getActiveCall(data.channelId);
      if (call) {
        // Notify other participants about the new joiner
        for (const participant of call.participants) {
          if (participant.channelId !== data.channelId) {
            // Get user info (this would need to be implemented)
            await this.notificationService.notifyParticipantJoined(
              participant.webhookUrl,
              `User ${data.userId}`, // Would need to get actual username
            );
          }
        }
      }
    });

    this.subscribe('call:participant-left', async (data) => {
      const call = await this.getActiveCall(data.channelId);
      if (call) {
        // Notify other participants about the user leaving
        for (const participant of call.participants) {
          if (participant.channelId !== data.channelId) {
            // Get user info (this would need to be implemented)
            await this.notificationService.notifyParticipantLeft(
              participant.webhookUrl,
              `User ${data.userId}`, // Would need to get actual username
            );
          }
        }
      }
    });
  }

  /**
   * Initiate a new call request
   */
  async initiateCall(channel: GuildTextBasedChannel, initiatorId: string): Promise<CallResult> {
    const startTime = Date.now();

    try {
      // Check call status and queue status simultaneously
      const [existingCall, inQueue] = await Promise.all([
        this.getActiveCall(channel.id),
        this.queueManager.isInQueue(channel.id),
      ]);

      if (existingCall) {
        return {
          success: false,
          message: '❌ This channel is already in an active call! Use `/hangup` to end it first.',
        };
      }

      if (inQueue) {
        return {
          success: false,
          message: '❌ This channel is already in the call queue! Please wait for a match.',
        };
      }

      // Get or create webhook - this is the main bottleneck
      const webhook = await getOrCreateWebhook(
        channel,
        channel.client.user.displayAvatarURL(),
        'InterChat Calls',
      );

      if (!webhook) {
        return {
          success: false,
          message: '❌ Failed to create webhook for this channel. Please check bot permissions.',
        };
      }

      // Create call request
      const request: CallRequest = {
        id: this.generateRequestId(),
        channelId: channel.id,
        guildId: channel.guildId,
        initiatorId,
        webhookUrl: webhook.url,
        timestamp: Date.now(),
        priority: 0,
      };

      // Add to queue and cache webhook simultaneously
      const queueStatus = await this.queueManager.enqueue(request);

      this.cacheManager.cacheWebhook(channel.id, webhook.url).catch((error) => {
        handleError(error, { comment: 'Failed to cache webhook' });
      });

      // Create database record asynchronously (don't wait for it)
      this.repository.createCall(initiatorId).catch((error) => {
        Logger.error('Error creating database record for call:', error);
      });

      const responseTime = Date.now() - startTime;

      Logger.info(
        `Call initiated for channel ${channel.id} by user ${initiatorId} (${responseTime}ms)`,
      );

      return {
        success: true,
        message: `🔍 **Looking for a match...** You're #${queueStatus.position} in queue (${queueStatus.queueLength} total).`,
      };
    }
    catch (error) {
      Logger.error(`Error initiating call for channel ${channel.id}:`, error);
      return {
        success: false,
        message: '❌ An error occurred while starting the call. Please try again.',
      };
    }
  }

  /**
   * End an active call or remove from queue
   */
  async hangupCall(channelId: string): Promise<CallResult> {
    const startTime = Date.now();

    try {
      // Parallel execution - check active call and queue status simultaneously
      const [call, inQueue] = await Promise.all([
        this.getActiveCall(channelId),
        this.queueManager.isInQueue(channelId),
      ]);

      if (!call) {
        if (inQueue) {
          // Remove from queue
          const removed = await this.removeChannelFromQueue(channelId);
          if (removed) {
            const responseTime = Date.now() - startTime;

            Logger.info(`Channel ${channelId} removed from call queue (${responseTime}ms)`);

            return {
              success: true,
              message: "✅ **Removed from queue!** You're no longer waiting for a call match.",
            };
          }
        }

        return {
          success: false,
          message: "❌ This channel isn't in an active call. Use `/call` to start one!",
        };
      }

      // Calculate call duration
      const duration = Date.now() - call.startTime;

      // Parallel execution - update database and send notifications simultaneously
      const notificationPromises = call.participants.map((participant) =>
        this.notificationService.notifyCallEnded(
          participant.channelId,
          call.id,
          duration,
          call.messages.length,
        ),
      );

      // Don't wait for database update - do it asynchronously
      this.repository.updateCallStatus(call.id, 'ENDED', new Date()).catch((error) => {
        Logger.error('Error updating call status in database:', error);
      });

      // Wait for notifications to complete
      await Promise.allSettled(notificationPromises);

      // Clear call state synchronously before emitting event to prevent race conditions
      // This is critical for the skip command which immediately tries to start a new call
      const clearStatePromises = call.participants.map(async (participant) => {
        await this.cacheManager.removeActiveCall(participant.channelId);
      });

      // Also clear from distributed state manager if available
      if (this.stateManager) {
        clearStatePromises.push(this.stateManager.removeActiveCall(call.id));
      }

      // Wait for all state clearing to complete
      await Promise.allSettled(clearStatePromises);

      // Emit call ended event (listeners will now be redundant but kept for compatibility)
      this.emit('call:ended', { call, duration });

      const responseTime = Date.now() - startTime;

      Logger.info(
        `Call ${call.id} ended for channel ${channelId} (duration: ${Math.round(duration / 1000)}s, response: ${responseTime}ms)`,
      );

      return {
        success: true,
        message: `📞 **Call ended!** Duration: ${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s. Thanks for using InterChat!`,
        callId: call.id,
      };
    }
    catch (error) {
      Logger.error(`Error hanging up call for channel ${channelId}:`, error);
      return {
        success: false,
        message: '❌ An error occurred while ending the call. Please try again.',
      };
    }
  }

  /**
   * Skip current call and find new match
   */
  async skipCall(channelId: string, userId: string): Promise<CallResult> {
    try {
      // End current call first
      const hangupResult = await this.hangupCall(channelId);
      if (!hangupResult.success) {
        return hangupResult;
      }

      // Now try to initiate a new call immediately
      // Get the channel object - we need this for webhook creation
      const channel = this.client.channels.cache.get(channelId);
      if (!channel || !channel.isSendable() || !('guild' in channel)) {
        return {
          success: false,
          message: '❌ Unable to access channel for new call. Please try `/call` manually.',
        };
      }

      // Attempt to start a new call immediately
      const newCallResult = await this.initiateCall(channel, userId);

      if (newCallResult.success) {
        // Successfully started new call (either connected or queued)
        if (newCallResult.message.includes('Looking for a match')) {
          // User was queued - use simplified notification message
          return {
            success: true,
            message: 'Looking for a Match...',
          };
        }
        else {
          // This shouldn't happen with current logic, but handle it
          return {
            success: true,
            message: '⏭️ **Call skipped and new match found!**',
          };
        }
      }
      else {
        // Failed to start new call
        return {
          success: false,
          message: `❌ Call ended but failed to start new match: ${newCallResult.message}`,
        };
      }
    }
    catch (error) {
      Logger.error(`Error skipping call for channel ${channelId}:`, error);
      return {
        success: false,
        message: '❌ An error occurred while skipping the call. Please try again.',
      };
    }
  }

  /**
   * Get active call data for a channel
   */
  async getActiveCall(channelId: string): Promise<ActiveCall | null> {
    try {
      // Try cache first (fastest)
      let call = await this.cacheManager.getActiveCall(channelId);

      if (!call && this.stateManager) {
        // Try distributed state manager (medium speed)
        call = await this.stateManager.getActiveCallByChannel(channelId);

        if (call) {
          // Cache for future access (don't wait for it)
          this.cacheManager.cacheActiveCall(call).catch((error) => {
            Logger.error('Error caching active call:', error);
          });
        }
      }

      // Skip database lookup for performance - if not in cache or state manager, assume no call
      // Database lookup is too slow for command response times

      return call;
    }
    catch (error) {
      Logger.error(`Error getting active call for channel ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Add participant to an active call
   */
  async addParticipant(channelId: string, userId: string): Promise<boolean> {
    try {
      const call = await this.getActiveCall(channelId);
      if (!call) {
        return false;
      }

      const participant = call.participants.find((p) => p.channelId === channelId);
      if (!participant) {
        return false;
      }

      // Add user to participant
      participant.users.add(userId);

      // Update cache
      await this.cacheManager.cacheActiveCall(call);

      // Update distributed state if available
      if (this.stateManager) {
        await this.stateManager.updateCallParticipant(call.id, channelId, userId, 'joined');
      }

      // Emit event
      this.emit('call:participant-joined', { callId: call.id, userId, channelId });

      Logger.debug(`User ${userId} joined call ${call.id} in channel ${channelId}`);
      return true;
    }
    catch (error) {
      Logger.error(`Error adding participant ${userId} to channel ${channelId}:`, error);
      return false;
    }
  }

  /**
   * Remove participant from an active call
   */
  async removeParticipant(channelId: string, userId: string): Promise<boolean> {
    try {
      const call = await this.getActiveCall(channelId);
      if (!call) {
        return false;
      }

      const participant = call.participants.find((p) => p.channelId === channelId);
      if (!participant) {
        return false;
      }

      // Remove user from participant
      participant.users.delete(userId);

      // Update cache
      await this.cacheManager.cacheActiveCall(call);

      // Update distributed state if available
      if (this.stateManager) {
        await this.stateManager.updateCallParticipant(call.id, channelId, userId, 'left');
      }

      // Emit event
      this.emit('call:participant-left', { callId: call.id, userId, channelId });

      Logger.debug(`User ${userId} left call ${call.id} in channel ${channelId}`);
      return true;
    }
    catch (error) {
      Logger.error(`Error removing participant ${userId} from channel ${channelId}:`, error);
      return false;
    }
  }

  /**
   * Update call with new message
   */
  async updateCallMessage(
    channelId: string,
    userId: string,
    username: string,
    content: string,
    attachmentUrl?: string,
  ): Promise<void> {
    try {
      const call = await this.getActiveCall(channelId);
      if (!call) {
        return;
      }

      const message = {
        authorId: userId,
        authorUsername: username,
        content,
        timestamp: Date.now(),
        attachmentUrl,
      };

      // Add message to call
      call.messages.push(message);

      // Keep only last 100 messages
      if (call.messages.length > 100) {
        call.messages = call.messages.slice(-100);
      }

      // Update cache
      await this.cacheManager.cacheActiveCall(call);

      // Update distributed state if available
      if (this.stateManager) {
        await this.stateManager.addCallMessage(call.id, message);
      }

      // Add to database
      await this.repository.addMessage(call.id, userId, username, content, attachmentUrl);

      // Emit event
      this.emit('call:message', { callId: call.id, message });
    }
    catch (error) {
      Logger.error(`Error updating call message for channel ${channelId}:`, error);
    }
  }

  /**
   * Remove channel from queue by channel ID
   */
  private async removeChannelFromQueue(channelId: string): Promise<boolean> {
    try {
      // Get the request data to find the request ID
      const requestData = await this.queueManager.getQueueStatus(channelId);
      if (!requestData) {
        return false;
      }

      // Use the dequeueByChannelId method that's now part of the interface
      return await this.queueManager.dequeueByChannelId(channelId);
    }
    catch (error) {
      Logger.error(`Error removing channel ${channelId} from queue:`, error);
      return false;
    }
  }

  // Private helper methods

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  async handleEvent(): Promise<void> {
    // Implementation for event handling if needed
  }
}
