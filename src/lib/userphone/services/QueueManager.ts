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
  private readonly queueKey = 'call:queue:v3'; // Sorted Set: channelId -> score
  private readonly channelDataKey = 'call:data:v3'; // Hash: channelId -> CallRequest
  private readonly requestIndexKey = 'request:to:channel:v3'; // Hash: requestId -> channelId
  private readonly maxQueueSize = 1000;
  private readonly queueTimeout: number;

  constructor(redis: Redis, queueTimeout: number = 30 * 60 * 1000) {
    // 30 minutes
    super();
    this.redis = redis;
    this.queueTimeout = queueTimeout;
  }

  protected setupEventListeners(): void {
    // Clean up expired queue entries periodically.
    setInterval(() => {
      this.cleanupExpiredRequests().catch((error) => {
        Logger.error('Error cleaning up expired queue requests:', error);
      });
    }, 60000); // Every minute
  }

  /**
   * Adds a request to the queue using efficient, indexed Redis operations.
   * Complexity: O(log N) due to ZADD.
   */
  async enqueue(request: CallRequest): Promise<QueueStatus> {
    const startTime = Date.now();

    try {
      // Check if the channel is already in the queue. O(1)
      const isMember = await this.redis.zscore(this.queueKey, request.channelId);
      if (isMember !== null) {
        throw new Error(`Channel ${request.channelId} is already in queue`);
      }

      // Check queue size limit. O(1)
      const queueLength = await this.redis.zcard(this.queueKey);
      if (queueLength >= this.maxQueueSize) {
        throw new Error('Queue is full, please try again later');
      }

      // Use timestamp for FIFO ordering, with an adjustment for priority.
      const score = request.timestamp - request.priority * 1000; // Lower score = higher priority

      // Use a pipeline to atomically add to the sorted set, channel data hash, and request ID index.
      const pipeline = this.redis.pipeline();
      const requestJSON = JSON.stringify(request);

      // Add channel to the queue (sorted set)
      pipeline.zadd(this.queueKey, score, request.channelId);

      // Store the full request object in a hash, keyed by channelId
      pipeline.hset(this.channelDataKey, request.channelId, requestJSON);

      // Index requestId to channelId for fast lookups. O(1)
      pipeline.hset(this.requestIndexKey, request.id, request.channelId);

      await pipeline.exec();

      // Get the final queue status.
      const status = await this.getQueueStatus(request.channelId);

      Logger.debug(
        `Enqueued call request for channel ${request.channelId} (${Date.now() - startTime}ms)`,
      );

      // Emit the event for other parts of the system.
      this.emit('call:queued', { request, queueStatus: status! });

      return status!;
    }
    catch (error) {
      Logger.error(`Error enqueuing call request for channel ${request.channelId}:`, error);
      // If enqueue fails, attempt a cleanup to prevent orphaned data.
      await this.dequeueByChannelId(request.channelId, request.id).catch((cleanupError) => {
        Logger.error(
          `Failed to cleanup after enqueue error for channel ${request.channelId}:`,
          cleanupError,
        );
      });
      throw error;
    }
  }

  /**
   * Removes a request from the queue using its unique request ID.
   * Complexity: O(log N) due to ZREM. The lookup is O(1).
   */
  async dequeue(requestId: string): Promise<boolean> {
    try {
      // Directly look up the channelId using the requestId index. O(1)
      const channelId = await this.redis.hget(this.requestIndexKey, requestId);

      if (!channelId) {
        // The request is not in the queue or has already been dequeued.
        return false;
      }

      // Use the retrieved channelId to perform the removal.
      return await this.dequeueByChannelId(channelId, requestId);
    }
    catch (error) {
      Logger.error(`Error dequeuing call request ${requestId}:`, error);
      return false;
    }
  }

  /**
   * Get queue status (position and length) for a specific channel.
   * Complexity: O(log N) due to ZRANK.
   */
  async getQueueStatus(channelId: string): Promise<QueueStatus | null> {
    try {
      // Atomically get rank and queue length.
      const pipeline = this.redis.pipeline();
      pipeline.zrank(this.queueKey, channelId);
      pipeline.zcard(this.queueKey);
      const results = await pipeline.exec();

      const rank = results?.[0]?.[1] as number | null;
      const queueLength = results?.[1]?.[1] as number | null;

      if (rank === null || queueLength === null) {
        return null; // Not in queue
      }

      return {
        position: rank + 1, // Convert 0-based rank to 1-based position
        queueLength,
      };
    }
    catch (error) {
      Logger.error(`Error getting queue status for channel ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Retrieves all pending requests from the queue.
   * Note: This can be a heavy operation on very large queues.
   * Complexity: O(N) where N is the number of items in the queue, due to ZRANGE and HMGET.
   */
  async getPendingRequests(): Promise<CallRequest[]> {
    try {
      // Get all channel IDs from the queue, in order.
      const channelIds = await this.redis.zrange(this.queueKey, 0, -1);

      if (channelIds.length === 0) {
        return [];
      }

      // fetch all corresponding request data in one command.
      const requestsData = await this.redis.hmget(this.channelDataKey, ...channelIds);

      // Filter out null results (if any inconsistencies exist) and parse the data.
      return requestsData
        .filter((data): data is string => data !== null)
        .map((data) => JSON.parse(data) as CallRequest);
    }
    catch (error) {
      Logger.error('Error getting pending requests:', error);
      return [];
    }
  }

  /**
   * Checks if a channel is currently in the queue.
   * Complexity: O(1).
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
   * Gets the total number of items in the queue.
   * Complexity: O(1).
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
   * Removes a request from the queue using its channel ID.
   * This is an internal helper, also callable directly if needed.
   */
  async dequeueByChannelId(channelId: string, requestId?: string): Promise<boolean> {
    try {
      let finalRequestId = requestId;
      // If requestId isn't provided, we must fetch it to clean up the index.
      if (!finalRequestId) {
        const requestJSON = await this.redis.hget(this.channelDataKey, channelId);
        if (requestJSON) {
          finalRequestId = (JSON.parse(requestJSON) as CallRequest).id;
        }
      }

      // Atomically remove the item from all data structures.
      const pipeline = this.redis.pipeline();
      pipeline.zrem(this.queueKey, channelId);
      pipeline.hdel(this.channelDataKey, channelId);
      if (finalRequestId) {
        pipeline.hdel(this.requestIndexKey, finalRequestId);
      }

      const results = await pipeline.exec();
      const removed = results?.[0]?.[1] as number;

      if (removed > 0) {
        Logger.debug(`Dequeued call request from channel ${channelId}`);
      }
      return removed > 0;
    }
    catch (error) {
      Logger.error(`Error dequeuing channel ${channelId}:`, error);
      return false;
    }
  }

  /**
   * Efficiently cleans up expired requests without scanning the entire dataset.
   * Complexity: O(log N + M) where M is the number of expired items.
   */
  private async cleanupExpiredRequests(): Promise<void> {
    try {
      const cutoffScore = Date.now() - this.queueTimeout;

      // **OPTIMIZATION**: Get the channel IDs of expired items before removing them.
      const expiredChannelIds = await this.redis.zrangebyscore(
        this.queueKey,
        '-inf',
        `(${cutoffScore}`,
      );

      if (expiredChannelIds.length === 0) {
        return; // Nothing to clean up.
      }

      Logger.info(`Found ${expiredChannelIds.length} expired requests to clean up.`);

      // Get the request data for the expired channels to find their requestIds.
      const expiredRequestsData = await this.redis.hmget(this.channelDataKey, ...expiredChannelIds);
      const expiredRequestIds = expiredRequestsData
        .filter((data): data is string => data !== null)
        .map((data) => (JSON.parse(data) as CallRequest).id);

      // Atomically remove all data associated with the expired items.
      const pipeline = this.redis.pipeline();
      pipeline.zrem(this.queueKey, ...expiredChannelIds); // Remove from queue
      pipeline.hdel(this.channelDataKey, ...expiredChannelIds); // Remove channel data
      if (expiredRequestIds.length > 0) {
        pipeline.hdel(this.requestIndexKey, ...expiredRequestIds); // Remove from index
      }

      await pipeline.exec();

      Logger.info(`Cleaned up ${expiredChannelIds.length} expired queue requests successfully.`);
    }
    catch (error) {
      Logger.error('Error during optimized cleanup of expired requests:', error);
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
    // Implementation for event handling when needed
  }
}
