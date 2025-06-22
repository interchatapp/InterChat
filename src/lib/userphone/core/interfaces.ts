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

import type { GuildTextBasedChannel } from 'discord.js';
import type {
  ActiveCall,
  CallRequest,
  CallResult,
  MatchResult,
  QueueStatus,
} from './types.js';

// ============================================================================
// Core Service Interfaces
// ============================================================================

/**
 * Main interface for call management operations
 */
export interface ICallManager {
  /**
   * Initiate a new call request
   */
  initiateCall(channel: GuildTextBasedChannel, initiatorId: string): Promise<CallResult>;

  /**
   * End an active call
   */
  hangupCall(channelId: string): Promise<CallResult>;

  /**
   * Skip current call and find new match
   */
  skipCall(channelId: string, userId: string): Promise<CallResult>;

  /**
   * Get active call data for a channel
   */
  getActiveCall(channelId: string): Promise<ActiveCall | null>;

  /**
   * Add participant to an active call
   */
  addParticipant(channelId: string, userId: string): Promise<boolean>;

  /**
   * Remove participant from an active call
   */
  removeParticipant(channelId: string, userId: string): Promise<boolean>;

  /**
   * Update call with new message
   */
  updateCallMessage(
    channelId: string,
    userId: string,
    username: string,
    content: string,
    attachmentUrl?: string
  ): Promise<void>;
}

/**
 * Real-time matching engine interface
 */
export interface IMatchingEngine {
  /**
   * Start the background matching process
   */
  start(): Promise<void>;

  /**
   * Stop the background matching process
   */
  stop(): Promise<void>;

  /**
   * Try to find a match for a call request
   */
  findMatch(request: CallRequest): Promise<MatchResult>;

  /**
   * Get current matching statistics
   */
  getMatchingStats(): Promise<{
    averageMatchTime: number;
    successRate: number;
    queueLength: number;
  }>;
}

/**
 * Queue management interface
 */
export interface IQueueManager {
  /**
   * Add request to queue
   */
  enqueue(request: CallRequest): Promise<QueueStatus>;

  /**
   * Remove request from queue
   */
  dequeue(requestId: string): Promise<boolean>;

  /**
   * Get queue status for a channel
   */
  getQueueStatus(channelId: string): Promise<QueueStatus | null>;

  /**
   * Get all pending requests (for matching)
   */
  getPendingRequests(): Promise<CallRequest[]>;

  /**
   * Check if channel is in queue
   */
  isInQueue(channelId: string): Promise<boolean>;

  /**
   * Get queue length
   */
  getQueueLength(): Promise<number>;

  /**
   * Remove request by channel ID
   */
  dequeueByChannelId(channelId: string): Promise<boolean>;
}

/**
 * Caching layer interface
 */
export interface ICacheManager {
  /**
   * Get or create webhook for channel
   */
  getWebhook(channelId: string): Promise<string | null>;

  /**
   * Cache webhook URL for channel
   */
  cacheWebhook(channelId: string, webhookUrl: string): Promise<void>;

  /**
   * Get cached active call
   */
  getActiveCall(channelId: string): Promise<ActiveCall | null>;

  /**
   * Cache active call data
   */
  cacheActiveCall(call: ActiveCall): Promise<void>;

  /**
   * Remove call from cache
   */
  removeActiveCall(channelId: string): Promise<void>;

  /**
   * Check if users have recently matched
   */
  hasRecentMatch(userId1: string, userId2: string): Promise<boolean>;

  /**
   * Record recent match between users
   */
  recordRecentMatch(userId1: string, userId2: string): Promise<void>;
}

/**
 * Database operations interface
 */
export interface ICallRepository {
  /**
   * Create new call in database
   */
  createCall(initiatorId: string): Promise<{ id: string }>;

  /**
   * Update call status
   */
  updateCallStatus(callId: string, status: string, endTime?: Date): Promise<void>;

  /**
   * Add participant to call
   */
  addParticipant(
    callId: string,
    channelId: string,
    guildId: string,
    webhookUrl: string
  ): Promise<{ id: string }>;

  /**
   * Add user to participant
   */
  addUserToParticipant(participantId: string, userId: string): Promise<void>;

  /**
   * Remove user from participant
   */
  removeUserFromParticipant(participantId: string, userId: string): Promise<void>;

  /**
   * Add message to call
   */
  addMessage(
    callId: string,
    authorId: string,
    authorUsername: string,
    content: string,
    attachmentUrl?: string
  ): Promise<void>;

  /**
   * Get active call by channel
   */
  getActiveCallByChannel(channelId: string): Promise<ActiveCall | null>;

  /**
   * Get call statistics
   */
  getCallStats(callId: string): Promise<{
    totalMessages: number;
    totalParticipants: number;
    duration: number | null;
  }>;
}

/**
 * Real-time notification interface
 */
export interface INotificationService {
  /**
   * Notify channel about call match
   */
  notifyCallMatched(channelId: string, call: ActiveCall): Promise<void>;

  /**
   * Notify channel about call end with stats
   */
  notifyCallEnded(
    channelId: string,
    callId: string,
    duration?: number,
    messageCount?: number,
  ): Promise<void>;

  /**
   * Notify about call start
   */
  notifyCallStarted(channelId: string, call: ActiveCall): Promise<void>;

  //   /**
  //    * Notify about queue position update
  //    */
  //   notifyQueueUpdate(channelId: string, status: QueueStatus): Promise<void>;

  //   /**
  //    * Notify about queue entry
  //    */
  //   notifyQueueEntry(channelId: string, status: QueueStatus): Promise<void>;

  /**
   * Notify about call timeout
   */
  notifyCallTimeout(channelId: string): Promise<void>;

  /**
   * Notify about connection errors
   */
  notifyConnectionError(channelId: string, errorType: string, retryable?: boolean): Promise<void>;

  /**
   * Notify about participant joining
   */
  notifyParticipantJoined(webhookUrl: string, username: string, guildName?: string): Promise<void>;

  /**
   * Notify about participant leaving
   */
  notifyParticipantLeft(webhookUrl: string, username: string, guildName?: string): Promise<void>;

  /**
   * Send system message to call participants
   */
  sendSystemMessage(
    webhookUrl: string,
    content: string,
    components?: unknown[]
  ): Promise<void>;
}

/**
 * Performance monitoring interface
 */
export interface ICallMetrics {
  /**
   * Start timing an operation
   */
  startTimer(operation: string): () => void;

  /**
   * Record command execution time
   */
  recordCommandTime(command: string, duration: number): void;

  /**
   * Record matching time
   */
  recordMatchingTime(duration: number): void;

  /**
   * Get performance statistics
   */
  getStats(): Promise<{
    averageCommandTime: number;
    averageMatchingTime: number;
    matchingSuccessRate: number;
  }>;
}
