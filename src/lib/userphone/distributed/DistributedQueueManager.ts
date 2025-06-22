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
 * Simplified distributed queue manager with efficient Redis operations
 * Minimal coordination overhead while maintaining distributed capabilities
 */
export class DistributedQueueManager extends CallEventHandler implements IQueueManager {
  private readonly redis: Redis;
  private readonly clusterId: number;
  private readonly queueTimeout: number;

  // Simplified Redis keys
  private readonly keys = {
    globalQueue: 'call:queue:global:v3',
    channelIndex: 'call:queue:channels:v3',
    leaderLock: 'call:queue:leader',
  };

  private readonly maxQueueSize = 1000;
  private isLeader = false;

  constructor(
    redis: Redis,
    clusterId: number,
    queueTimeout: number = 30 * 60 * 1000,
  ) {
    super();
    this.redis = redis;
    this.clusterId = clusterId;
    this.queueTimeout = queueTimeout;

    this.startLeaderElection();
  }

  protected setupEventListeners(): void {
    // Simplified cleanup - only expired requests
    setInterval(() => {
      this.cleanupExpiredRequests().catch((error) => {
        Logger.error('Error cleaning up expired queue requests:', error);
      });
    }, 300000); // Every 5 minutes (reduced frequency)
  }

  /**
   * Simple leader election - first cluster to acquire lock becomes leader
   */
  private startLeaderElection(): void {
    setInterval(async () => {
      try {
        const result = await this.redis.set(
          this.keys.leaderLock,
          this.clusterId.toString(),
          'PX',
          30000, // 30 second TTL
          'NX',
        );

        if (result === 'OK') {
          if (!this.isLeader) {
            this.isLeader = true;
            Logger.info(`Cluster ${this.clusterId} became queue leader`);
          }
        }
        else {
          // Check if we're still the leader
          const currentLeader = await this.redis.get(this.keys.leaderLock);
          this.isLeader = currentLeader === this.clusterId.toString();
        }
      }
      catch (error) {
        Logger.error('Error in leader election:', error);
        this.isLeader = false;
      }
    }, 15000); // Check every 15 seconds
  }

  /**
   * Add request to distributed queue - simplified with atomic operations
   */
  async enqueue(request: CallRequest): Promise<QueueStatus> {
    const startTime = Date.now();

    try {
      // Use Redis atomic operations instead of distributed locking
      const pipeline = this.redis.pipeline();

      // Check if already in queue and add atomically
      const score = request.timestamp + (request.priority * 1000);

      // Add to global queue (will fail if already exists due to sorted set nature)
      pipeline.zadd(this.keys.globalQueue, 'NX', score, request.channelId);

      // Store request data with cluster info
      const requestWithCluster = {
        ...request,
        clusterId: this.clusterId,
        enqueuedAt: Date.now(),
      };
      pipeline.hset(
        this.keys.channelIndex,
        request.channelId,
        JSON.stringify(requestWithCluster),
      );

      // Set expiry for cleanup
      pipeline.expire(this.keys.channelIndex, Math.ceil(this.queueTimeout / 1000));

      const results = await pipeline.exec();
      const added = results?.[0]?.[1] as number;

      if (added === 0) {
        throw new Error(`Channel ${request.channelId} is already in queue`);
      }

      // Get queue status
      const status = await this.getQueueStatus(request.channelId);
      if (!status) {
        throw new Error('Failed to get queue status after enqueue');
      }

      Logger.debug(`Enqueued call request for channel ${request.channelId} on cluster ${this.clusterId} (${Date.now() - startTime}ms)`);

      // Simplified event emission
      this.emit('call:queued', { request: requestWithCluster, queueStatus: status });

      return status;
    }
    catch (error) {
      Logger.error(`Error enqueuing call request for channel ${request.channelId}:`, error);
      throw error;
    }
  }

  /**
   * Remove request from distributed queue - simplified
   */
  async dequeue(requestId: string): Promise<boolean> {
    try {
      // Find the request by scanning channel index
      const channelIds = await this.redis.hkeys(this.keys.channelIndex);
      let targetChannelId: string | null = null;

      for (const channelId of channelIds) {
        const requestData = await this.redis.hget(this.keys.channelIndex, channelId);
        if (requestData) {
          try {
            const request = JSON.parse(requestData);
            if (request.id === requestId) {
              targetChannelId = channelId;
              break;
            }
          }
          catch {
            // Clean up corrupted data
            await this.redis.hdel(this.keys.channelIndex, channelId);
          }
        }
      }

      if (!targetChannelId) {
        return false;
      }

      // Remove from both structures atomically
      const pipeline = this.redis.pipeline();
      pipeline.zrem(this.keys.globalQueue, targetChannelId);
      pipeline.hdel(this.keys.channelIndex, targetChannelId);

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
   * Get queue status with distributed awareness
   */
  async getQueueStatus(channelId: string): Promise<QueueStatus | null> {
    try {
      // Get position in global queue
      const rank = await this.redis.zrank(this.keys.globalQueue, channelId);
      if (rank === null) {
        return null; // Not in queue
      }

      // Get total global queue length
      const queueLength = await this.redis.zcard(this.keys.globalQueue);

      // Estimate wait time based on position and distributed matching rate
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
   * Get pending requests - simplified without cluster filtering
   */
  async getPendingRequests(): Promise<CallRequest[]> {
    try {
      // Get all requests from queue (leader processes all)
      const channelIds = await this.redis.zrange(this.keys.globalQueue, 0, -1);

      if (channelIds.length === 0) {
        return [];
      }

      // Get request data for all channels
      const requestsData = await this.redis.hmget(this.keys.channelIndex, ...channelIds);

      const requests: CallRequest[] = [];
      for (let i = 0; i < channelIds.length; i++) {
        const requestData = requestsData[i];
        if (requestData) {
          try {
            const request = JSON.parse(requestData);
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
   * Check if channel is in global queue
   */
  async isInQueue(channelId: string): Promise<boolean> {
    try {
      const score = await this.redis.zscore(this.keys.globalQueue, channelId);
      return score !== null;
    }
    catch (error) {
      Logger.error(`Error checking if channel ${channelId} is in queue:`, error);
      return false;
    }
  }

  /**
   * Get global queue length
   */
  async getQueueLength(): Promise<number> {
    try {
      return await this.redis.zcard(this.keys.globalQueue);
    }
    catch (error) {
      Logger.error('Error getting queue length:', error);
      return 0;
    }
  }

  /**
   * Get simplified queue statistics
   */
  async getDistributedQueueStats(): Promise<{
    globalLength: number;
    clusterDistribution: Record<number, number>;
    oldestRequestAge: number;
  }> {
    try {
      const globalLength = await this.redis.zcard(this.keys.globalQueue);

      // Simplified cluster distribution - just show current cluster
      const clusterDistribution: Record<number, number> = {
        [this.clusterId]: globalLength,
      };

      // Get oldest request age
      let oldestRequestAge = 0;
      if (globalLength > 0) {
        const oldestEntries = await this.redis.zrange(this.keys.globalQueue, 0, 0, 'WITHSCORES');
        if (oldestEntries.length > 1) {
          const oldestScore = parseFloat(oldestEntries[1]);
          oldestRequestAge = Date.now() - oldestScore;
        }
      }

      return {
        globalLength,
        clusterDistribution,
        oldestRequestAge,
      };
    }
    catch (error) {
      Logger.error('Error getting distributed queue stats:', error);
      return { globalLength: 0, clusterDistribution: {}, oldestRequestAge: 0 };
    }
  }

  /**
   * Check if this cluster is the queue leader
   */
  isQueueLeader(): boolean {
    return this.isLeader;
  }

  async dequeueByChannelId(channelId: string): Promise<boolean> {
    try {
      // Simplified removal - just from main structures
      const pipeline = this.redis.pipeline();
      pipeline.zrem(this.keys.globalQueue, channelId);
      pipeline.hdel(this.keys.channelIndex, channelId);

      const results = await pipeline.exec();
      const removed = results?.[0]?.[1] as number;

      return removed > 0;
    }
    catch (error) {
      Logger.error(`Error dequeuing channel ${channelId}:`, error);
      return false;
    }
  }

  private async cleanupExpiredRequests(): Promise<void> {
    try {
      const cutoffTime = Date.now() - this.queueTimeout;

      // Remove expired entries from global queue
      const removed = await this.redis.zremrangebyscore(this.keys.globalQueue, 0, cutoffTime);

      if (removed > 0) {
        Logger.info(`Cleaned up ${removed} expired queue requests`);

        // Clean up corresponding channel index entries
        const remainingChannels = await this.redis.zrange(this.keys.globalQueue, 0, -1);
        const allChannels = await this.redis.hkeys(this.keys.channelIndex);

        // Remove channel index entries that are no longer in queue
        const toRemove = allChannels.filter((channel) => !remainingChannels.includes(channel));
        if (toRemove.length > 0) {
          await this.redis.hdel(this.keys.channelIndex, ...toRemove);
        }
      }
    }
    catch (error) {
      Logger.error('Error cleaning up expired requests:', error);
    }
  }

  async handleEvent(): Promise<void> {
    // Implementation for event handling if needed
  }
}
