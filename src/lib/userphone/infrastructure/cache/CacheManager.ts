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
import type { ICacheManager } from '../../core/interfaces.js';
import type { ActiveCall, CacheConfig } from '../../core/types.js';
import { WebhookCache } from './WebhookCache.js';
import Logger from '#src/utils/Logger.js';

/**
 * Unified cache manager for all calling system caching needs
 */
export class CacheManager implements ICacheManager {
  private readonly redis: Redis;
  private readonly config: CacheConfig;
  private readonly webhookCache: WebhookCache;

  // Cache keys
  private readonly keys = {
    activeCalls: 'call:cache:active',
    recentMatches: 'call:cache:recent_matches',
  };

  constructor(redis: Redis, config: CacheConfig) {
    this.redis = redis;
    this.config = config;
    this.webhookCache = new WebhookCache(redis, config.webhookTtl);
  }

  /**
   * Get or create webhook for channel
   */
  async getWebhook(channelId: string): Promise<string | null> {
    try {
      const key = `webhook:cache:${channelId}`;
      return await this.redis.get(key);
    }
    catch (error) {
      Logger.error(`Error getting webhook for channel ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Cache webhook URL for channel
   */
  async cacheWebhook(channelId: string, webhookUrl: string): Promise<void> {
    try {
      const key = `webhook:cache:${channelId}`;
      await this.redis.setex(key, this.config.webhookTtl, webhookUrl);
    }
    catch (error) {
      Logger.error(`Error caching webhook for channel ${channelId}:`, error);
    }
  }

  /**
   * Get cached active call
   */
  async getActiveCall(channelId: string): Promise<ActiveCall | null> {
    try {
      const callData = await this.redis.hget(this.keys.activeCalls, channelId);
      if (!callData) {
        return null;
      }

      return JSON.parse(callData, (key, value) => {
        if (key === 'users' && Array.isArray(value)) {
          return new Set(value);
        }
        return value;
      });
    }
    catch (error) {
      Logger.error(`Error getting active call for channel ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Cache active call data
   */
  async cacheActiveCall(call: ActiveCall): Promise<void> {
    try {
      const callData = JSON.stringify(call, (key, value) => {
        if (value instanceof Set) {
          return Array.from(value);
        }
        return value;
      });

      // Cache by call ID and by each participant channel
      const pipeline = this.redis.pipeline();

      for (const participant of call.participants) {
        pipeline.hset(this.keys.activeCalls, participant.channelId, callData);
      }

      pipeline.expire(this.keys.activeCalls, this.config.callTtl);
      await pipeline.exec();
    }
    catch (error) {
      Logger.error(`Error caching active call ${call.id}:`, error);
    }
  }

  /**
   * Remove call from cache
   */
  async removeActiveCall(channelId: string): Promise<void> {
    try {
      await this.redis.hdel(this.keys.activeCalls, channelId);
    }
    catch (error) {
      Logger.error(`Error removing active call for channel ${channelId}:`, error);
    }
  }

  /**
   * Check if users have recently matched
   */
  async hasRecentMatch(userId1: string, userId2: string): Promise<boolean> {
    try {
      const key1 = `${this.keys.recentMatches}:${userId1}:${userId2}`;
      const key2 = `${this.keys.recentMatches}:${userId2}:${userId1}`;

      const [match1, match2] = await Promise.all([
        this.redis.exists(key1),
        this.redis.exists(key2),
      ]);

      return match1 > 0 || match2 > 0;
    }
    catch (error) {
      Logger.error(`Error checking recent match between ${userId1} and ${userId2}:`, error);
      return false;
    }
  }

  /**
   * Record recent match between users
   */
  async recordRecentMatch(userId1: string, userId2: string): Promise<void> {
    try {
      const key1 = `${this.keys.recentMatches}:${userId1}:${userId2}`;
      const key2 = `${this.keys.recentMatches}:${userId2}:${userId1}`;
      const ttl = 24 * 60 * 60; // 24 hours

      const pipeline = this.redis.pipeline();
      pipeline.setex(key1, ttl, Date.now().toString());
      pipeline.setex(key2, ttl, Date.now().toString());
      await pipeline.exec();
    }
    catch (error) {
      Logger.error(`Error recording recent match between ${userId1} and ${userId2}:`, error);
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    activeCallsCount: number;
    recentMatchesCount: number;
    webhookCacheStats: {
      totalCached: number;
      hitRate: number;
      avgResponseTime: number;
    };
  }> {
    try {
      const [activeCallsCount, recentMatchesKeys, webhookCacheStats] = await Promise.all([
        this.redis.hlen(this.keys.activeCalls),
        this.redis.keys(`${this.keys.recentMatches}:*`),
        this.webhookCache.getCacheStats(),
      ]);

      return {
        activeCallsCount,
        recentMatchesCount: recentMatchesKeys.length,
        webhookCacheStats,
      };
    }
    catch (error) {
      Logger.error('Error getting cache stats:', error);
      return {
        activeCallsCount: 0,
        recentMatchesCount: 0,
        webhookCacheStats: {
          totalCached: 0,
          hitRate: 0,
          avgResponseTime: 0,
        },
      };
    }
  }

  /**
   * Clear all cache data (for testing/maintenance)
   */
  async clearCache(): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();

      // Clear active calls
      pipeline.del(this.keys.activeCalls);

      // Clear recent matches
      const recentMatchKeys = await this.redis.keys(`${this.keys.recentMatches}:*`);
      if (recentMatchKeys.length > 0) {
        pipeline.del(...recentMatchKeys);
      }

      // Clear webhook cache
      const webhookKeys = await this.redis.keys('webhook:cache:*');
      if (webhookKeys.length > 0) {
        pipeline.del(...webhookKeys);
      }

      await pipeline.exec();
      Logger.info('Cache cleared successfully');
    }
    catch (error) {
      Logger.error('Error clearing cache:', error);
    }
  }

  /**
   * Cleanup expired cache entries
   */
  async cleanup(): Promise<void> {
    try {
      // Redis handles TTL automatically, but we can do additional cleanup here
      await this.webhookCache.cleanup();

      Logger.debug('Cache cleanup completed');
    }
    catch (error) {
      Logger.error('Error during cache cleanup:', error);
    }
  }
}
