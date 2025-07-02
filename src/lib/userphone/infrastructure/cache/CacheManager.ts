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
import { GuildTextBasedChannel } from 'discord.js';

/**
 * Unified cache manager for the calling system.
 */
export class CacheManager implements ICacheManager {
  private readonly redis: Redis;
  private readonly config: CacheConfig;
  public readonly webhookCache: WebhookCache;

  private readonly keys = {
    activeCallDataPrefix: 'call:cache:data', // Prefix for key: callId -> ActiveCall
    activeCallIndex: 'call:cache:index', // Hash: channelId -> callId
    activeCallIdSet: 'call:cache:id_set', // Set: of active call IDs
    recentMatchesIndex: 'call:cache:recent_matches:index', // Set: of recent match keys
    recentMatchesPrefix: 'call:cache:recent_matches:entry', // Prefix for key: user1:user2 -> 1
  };

  constructor(redis: Redis, config: CacheConfig) {
    this.redis = redis;
    this.config = config;
    this.webhookCache = new WebhookCache(redis, config.webhookTtlSecs);
  }

  // Delegate Webhook logic to the dedicated WebhookCache class
  async getWebhook(channel: GuildTextBasedChannel): Promise<string | null> {
    return this.webhookCache.getOrCreateWebhook(channel);
  }

  async cacheWebhook(channelId: string, webhookUrl: string): Promise<void> {
    return this.webhookCache.cacheWebhook(channelId, webhookUrl);
  }

  /**
   * Gets a cached active call by a participant's channelId.
   */
  async getActiveCall(channelId: string): Promise<ActiveCall | null> {
    try {
      const callId = await this.redis.hget(this.keys.activeCallIndex, channelId);
      if (!callId) return null;

      const callDataKey = `${this.keys.activeCallDataPrefix}:${callId}`;
      const callData = await this.redis.get(callDataKey);
      if (!callData) {
        await this.redis.hdel(this.keys.activeCallIndex, channelId); // Inconsistency cleanup
        return null;
      }

      return JSON.parse(callData, (key, value) => {
        if (key === 'users' && Array.isArray(value)) return new Set(value);
        return value;
      });
    }
    catch (error) {
      Logger.error(`Error getting active call for channel ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Caches active call data efficiently, avoiding data duplication.
   */
  async cacheActiveCall(call: ActiveCall): Promise<void> {
    try {
      const callData = JSON.stringify(call, (key, value) => {
        if (value instanceof Set) return Array.from(value);
        return value;
      });

      const pipeline = this.redis.pipeline();
      const callDataKey = `${this.keys.activeCallDataPrefix}:${call.id}`;

      pipeline.setex(callDataKey, this.config.callTtlSecs, callData);
      pipeline.sadd(this.keys.activeCallIdSet, call.id);

      for (const participant of call.participants) {
        pipeline.hset(this.keys.activeCallIndex, participant.channelId, call.id);
      }

      await pipeline.exec();
    }
    catch (error) {
      Logger.error(`Error caching active call ${call.id}:`, error);
    }
  }

  /**
   * Removes an entire call from the cache, including all participant mappings.
   */
  async removeActiveCall(anyChannelId: string): Promise<void> {
    try {
      const call = await this.getActiveCall(anyChannelId);
      if (!call) {
        await this.redis.hdel(this.keys.activeCallIndex, anyChannelId);
        return;
      }

      const channelIds = call.participants.map((p) => p.channelId);
      const callDataKey = `${this.keys.activeCallDataPrefix}:${call.id}`;

      const pipeline = this.redis.pipeline();
      pipeline.del(callDataKey);
      pipeline.hdel(this.keys.activeCallIndex, ...channelIds);
      pipeline.srem(this.keys.activeCallIdSet, call.id);
      await pipeline.exec();
    }
    catch (error) {
      Logger.error(`Error removing active call for channel ${anyChannelId}:`, error);
    }
  }

  /**
   * Checks if two users have recently matched in a single roundtrip.
   */
  async hasRecentMatch(userId1: string, userId2: string): Promise<boolean> {
    try {
      const key = [userId1, userId2].sort().join(':');
      const matchKey = `${this.keys.recentMatchesPrefix}:${key}`;
      return (await this.redis.exists(matchKey)) > 0;
    }
    catch (error) {
      Logger.error(`Error checking recent match between ${userId1} and ${userId2}:`, error);
      return false;
    }
  }

  /**
   * Records a recent match between two users efficiently.
   */
  async recordRecentMatch(userId1: string, userId2: string): Promise<void> {
    try {
      const key = [userId1, userId2].sort().join(':');
      const matchKey = `${this.keys.recentMatchesPrefix}:${key}`;
      const ttl = 24 * 60 * 60; // 24 hours

      const pipeline = this.redis.pipeline();
      pipeline.setex(matchKey, ttl, '1');
      pipeline.sadd(this.keys.recentMatchesIndex, matchKey);
      await pipeline.exec();
    }
    catch (error) {
      Logger.error(`Error recording recent match between ${userId1} and ${userId2}:`, error);
    }
  }

  /**
   * Gets cache statistics efficiently without using the KEYS command.
   */
  async getCacheStats() {
    try {
      const [activeCallsCount, activeParticipantsCount, recentMatchesCount, webhookCacheStats] =
        await Promise.all([
          this.redis.scard(this.keys.activeCallIdSet),
          this.redis.hlen(this.keys.activeCallIndex),
          this.redis.scard(this.keys.recentMatchesIndex),
          this.webhookCache.getCacheStats(),
        ]);

      return { activeCallsCount, activeParticipantsCount, recentMatchesCount, webhookCacheStats };
    }
    catch (error) {
      Logger.error('Error getting cache stats:', error);
      return {
        activeCallsCount: 0,
        activeParticipantsCount: 0,
        recentMatchesCount: 0,
        webhookCacheStats: {},
      };
    }
  }

  /**
   * Clears all managed cache data
   */
  async clearCache(): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();

      const callIds = await this.redis.smembers(this.keys.activeCallIdSet);
      if (callIds.length > 0) {
        const callDataKeys = callIds.map((id) => `${this.keys.activeCallDataPrefix}:${id}`);
        pipeline.del(...callDataKeys);
      }
      pipeline.del(this.keys.activeCallIndex);
      pipeline.del(this.keys.activeCallIdSet);

      const matchKeys = await this.redis.smembers(this.keys.recentMatchesIndex);
      if (matchKeys.length > 0) {
        pipeline.del(...matchKeys);
      }
      pipeline.del(this.keys.recentMatchesIndex);

      await pipeline.exec();
      await this.webhookCache.cleanup();

      Logger.info('Cache cleared successfully');
    }
    catch (error) {
      Logger.error('Error clearing cache:', error);
    }
  }
}
