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

import type { Redis } from 'ioredis';
import type { IQueueManager } from '../core/interfaces.js';
import type { CallRequest, QueueStatus } from '../core/types.js';
import { CallEventHandler } from '../core/events.js';
import Logger from '#src/utils/Logger.js';

/**
 * High-performance queue manager using Redis Sorted Sets
 * Replaces O(n) list operations with O(log n) sorted set operations
 */
export class QueueManager extends CallEventHandler implements IQueueManager {
  private readonly redis: Redis;
  private readonly queueKey = 'call:queue:v2';
  private readonly channelIndexKey = 'call:queue:channels';
  private readonly maxQueueSize = 1000;
  private readonly queueTimeout: number;

  constructor(redis: Redis, queueTimeout: number = 30 * 60 * 1000) { // 30 minutes
    super();
    this.redis = redis;
    this.queueTimeout = queueTimeout;
  }

  protected setupEventListeners(): void {
    // Clean up expired queue entries
    setInterval(() => {
      this.cleanupExpiredRequests().catch((error) => {
        Logger.error('Error cleaning up expired queue requests:', error);
      });
    }, 60000); // Every minute
  }

  /**
   * Add request to queue using Redis Sorted Set for O(log n) operations
   */
  async enqueue(request: CallRequest): Promise<QueueStatus> {
    const startTime = Date.now();

    try {
      // Check if channel is already in queue
      const existingScore = await this.redis.zscore(this.queueKey, request.channelId);
      if (existingScore !== null) {
        throw new Error(`Channel ${request.channelId} is already in queue`);
      }

      // Check queue size limit
      const queueLength = await this.redis.zcard(this.queueKey);
      if (queueLength >= this.maxQueueSize) {
        throw new Error('Queue is full, please try again later');
      }

      // Use timestamp as score for FIFO ordering, with priority adjustment
      const score = request.timestamp + (request.priority * 1000);

      // Add to sorted set and channel index in a pipeline
      const pipeline = this.redis.pipeline();
      pipeline.zadd(this.queueKey, score, request.channelId);
      pipeline.hset(this.channelIndexKey, request.channelId, JSON.stringify(request));
      pipeline.expire(this.channelIndexKey, Math.ceil(this.queueTimeout / 1000));

      await pipeline.exec();

      // Get queue status
      const status = await this.getQueueStatus(request.channelId);

      Logger.debug(`Enqueued call request for channel ${request.channelId} (${Date.now() - startTime}ms)`);

      // Emit event
      this.emit('call:queued', { request, queueStatus: status! });

      return status!;
    }
    catch (error) {
      Logger.error(`Error enqueuing call request for channel ${request.channelId}:`, error);
      throw error;
    }
  }

  /**
   * Remove request from queue
   */
  async dequeue(requestId: string): Promise<boolean> {
    try {
      // Find the request by ID in the channel index
      const channelIds = await this.redis.hkeys(this.channelIndexKey);
      let targetChannelId: string | null = null;

      for (const channelId of channelIds) {
        const requestData = await this.redis.hget(this.channelIndexKey, channelId);
        if (requestData) {
          const request: CallRequest = JSON.parse(requestData);
          if (request.id === requestId) {
            targetChannelId = channelId;
            break;
          }
        }
      }

      if (!targetChannelId) {
        return false;
      }

      // Remove from both sorted set and channel index
      const pipeline = this.redis.pipeline();
      pipeline.zrem(this.queueKey, targetChannelId);
      pipeline.hdel(this.channelIndexKey, targetChannelId);

      const results = await pipeline.exec();
      const removed = results?.[0]?.[1] as number;

      Logger.debug(`Dequeued call request ${requestId} from channel ${targetChannelId}`);
      return removed > 0;
    }
    catch (error) {
      Logger.error(`Error dequeuing call request ${requestId}:`, error);
      return false;
    }
  }

  /**
   * Get queue status for a channel
   */
  async getQueueStatus(channelId: string): Promise<QueueStatus | null> {
    try {
      // Get position in queue (0-based rank)
      const rank = await this.redis.zrank(this.queueKey, channelId);
      if (rank === null) {
        return null; // Not in queue
      }

      // Get total queue length
      const queueLength = await this.redis.zcard(this.queueKey);

      return {
        position: rank + 1, // Convert to 1-based position
        queueLength,
      };
    }
    catch (error) {
      Logger.error(`Error getting queue status for channel ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Get all pending requests for matching
   */
  async getPendingRequests(): Promise<CallRequest[]> {
    try {
      // Get all channel IDs in queue order
      const channelIds = await this.redis.zrange(this.queueKey, 0, -1);

      if (channelIds.length === 0) {
        return [];
      }

      // Get request data for all channels
      const requestsData = await this.redis.hmget(this.channelIndexKey, ...channelIds);

      const requests: CallRequest[] = [];
      for (let i = 0; i < channelIds.length; i++) {
        const requestData = requestsData[i];
        if (requestData) {
          try {
            const request: CallRequest = JSON.parse(requestData);
            requests.push(request);
          }
          catch (parseError) {
            Logger.error(`Error parsing request data for channel ${channelIds[i]}:`, parseError);
            // Clean up corrupted data
            await this.dequeueByChannelId(channelIds[i]);
          }
        }
      }

      return requests;
    }
    catch (error) {
      Logger.error('Error getting pending requests:', error);
      return [];
    }
  }

  /**
   * Check if channel is in queue
   */
  async isInQueue(channelId: string): Promise<boolean> {
    try {
      const score = await this.redis.zscore(this.queueKey, channelId);
      return score !== null;
    }
    catch (error) {
      Logger.error(`Error checking if channel ${channelId} is in queue:`, error);
      return false;
    }
  }

  /**
   * Get queue length
   */
  async getQueueLength(): Promise<number> {
    try {
      return await this.redis.zcard(this.queueKey);
    }
    catch (error) {
      Logger.error('Error getting queue length:', error);
      return 0;
    }
  }

  /**
   * Remove request by channel ID
   */
  async dequeueByChannelId(channelId: string): Promise<boolean> {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.zrem(this.queueKey, channelId);
      pipeline.hdel(this.channelIndexKey, channelId);

      const results = await pipeline.exec();
      const removed = results?.[0]?.[1] as number;

      return removed > 0;
    }
    catch (error) {
      Logger.error(`Error dequeuing channel ${channelId}:`, error);
      return false;
    }
  }

  /**
   * Clean up expired requests
   */
  private async cleanupExpiredRequests(): Promise<void> {
    try {
      const cutoffTime = Date.now() - this.queueTimeout;

      // Remove expired entries from sorted set
      const removed = await this.redis.zremrangebyscore(this.queueKey, 0, cutoffTime);

      if (removed > 0) {
        Logger.info(`Cleaned up ${removed} expired queue requests`);
      }

      // Clean up orphaned channel index entries
      const channelIds = await this.redis.hkeys(this.channelIndexKey);
      let orphanedCount = 0;

      for (const channelId of channelIds) {
        const inQueue = await this.redis.zscore(this.queueKey, channelId);
        if (inQueue === null) {
          await this.redis.hdel(this.channelIndexKey, channelId);
          orphanedCount++;
        }
      }

      if (orphanedCount > 0) {
        Logger.info(`Cleaned up ${orphanedCount} orphaned channel index entries`);
      }
    }
    catch (error) {
      Logger.error('Error cleaning up expired requests:', error);
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    length: number;
    oldestRequestAge: number;
  }> {
    try {
      const length = await this.redis.zcard(this.queueKey);

      if (length === 0) {
        return { length: 0, oldestRequestAge: 0 };
      }

      // Get oldest request
      const oldestEntries = await this.redis.zrange(this.queueKey, 0, 0, 'WITHSCORES');
      const oldestScore = oldestEntries.length > 1 ? parseFloat(oldestEntries[1]) : Date.now();
      const oldestRequestAge = Date.now() - oldestScore;

      return {
        length,
        oldestRequestAge,
      };
    }
    catch (error) {
      Logger.error('Error getting queue stats:', error);
      return { length: 0, oldestRequestAge: 0 };
    }
  }

  async handleEvent(): Promise<void> {
    // Implementation for event handling if needed
  }
}
