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

import type { ConvertDatesToString } from '#src/types/Utils.d.js';
import { handleError } from '#src/utils/Utils.js';
import getRedis from '#utils/Redis.js';
import type { Redis } from 'ioredis';

export interface CacheConfig {
  expirationMs?: number;
  prefix?: string;
}

export class CacheManager {
  public readonly redis: Redis;
  private readonly config: Required<CacheConfig>;
  private static readonly DEFAULT_EXPIRATION = 5 * 60 * 1000; // 5 minutes

  constructor(redis?: Redis, config: CacheConfig = {}) {
    this.redis = redis ?? getRedis();
    this.config = {
      expirationMs: config.expirationMs ?? CacheManager.DEFAULT_EXPIRATION,
      prefix: config.prefix ?? '',
    };
  }

  private getFullKey(key: string): string {
    return this.config.prefix ? `${this.config.prefix}:${key}` : key;
  }

  /**
   * Gets a value from cache, falling back to the provider function if not found
   */
  public async get<T>(
    key: string,
    provider?: () => Promise<T | null>,
  ): Promise<ConvertDatesToString<T> | null> {
    const fullKey = this.getFullKey(key);
    const cached = await this.redis.get(fullKey);

    if (cached) {
      try {
        return JSON.parse(cached) as ConvertDatesToString<T>;
      }
      catch (error) {
        handleError(error, { comment: `Failed to parse cached value for key ${fullKey}` });
      }
    }

    if (!provider) return null;

    const value = await provider();
    if (value !== null) {
      await this.set(key, value);
    }
    return value as ConvertDatesToString<T>;
  }

  /**
   * Sets a value in cache with optional expiration
   */
  public async set(key: string, value: unknown, expirationSecs?: number): Promise<void> {
    const fullKey = this.getFullKey(key);
    const serialized = JSON.stringify(value);

    if (expirationSecs) {
      await this.redis.setex(fullKey, expirationSecs, serialized);
    }
    else if (this.config.expirationMs) {
      await this.redis.psetex(fullKey, this.config.expirationMs, serialized);
    }
    else {
      await this.redis.set(fullKey, serialized);
    }
  }

  /**
   * Deletes a value from cache
   */
  public async delete(key: string): Promise<void> {
    await this.redis.del(this.getFullKey(key));
  }

  /**
   * Gets all members of a set from cache, falling back to provider if not found
   */
  public async getSetMembers<T>(key: string, provider?: () => Promise<T[]>): Promise<T[]> {
    const fullKey = this.getFullKey(key);
    const members = await this.redis.smembers(fullKey);

    if (members.length > 0) {
      try {
        return members.map((m) => JSON.parse(m)) as T[];
      }
      catch (error) {
        handleError(error, { comment: `Failed to parse cached set members for key ${fullKey}` });
      }
    }

    if (!provider) return [];

    const values = await provider();
    if (values.length > 0) {
      await this.setSetMembers(key, values);
    }
    return values;
  }

  /**
   * Sets members of a set in cache
   */
  public async setSetMembers<T>(key: string, members: T[], expirationSecs?: number): Promise<void> {
    const fullKey = this.getFullKey(key);
    const pipeline = this.redis.pipeline();

    // Clear existing set
    pipeline.del(fullKey);

    // Add new members
    if (members.length > 0) {
      const serialized = members.map((m) => JSON.stringify(m));
      pipeline.sadd(fullKey, ...serialized);

      if (expirationSecs) {
        pipeline.expire(fullKey, expirationSecs);
      }
      else if (this.config.expirationMs) {
        pipeline.pexpire(fullKey, this.config.expirationMs);
      }
    }

    await pipeline.exec();
  }

  /**
   * Adds a member to a set in cache
   */
  public async addSetMember<T>(key: string, member: T): Promise<void> {
    const fullKey = this.getFullKey(key);
    await this.redis.sadd(fullKey, JSON.stringify(member));
  }

  /**
   * Removes a member from a set in cache
   */
  public async removeSetMember<T>(key: string, member: T): Promise<void> {
    const fullKey = this.getFullKey(key);
    await this.redis.srem(fullKey, JSON.stringify(member));
  }

  public async setHashField<T>(
    key: string,
    field: string,
    value: T,
    expirationSecs?: number,
  ): Promise<void> {
    const fullKey = this.getFullKey(key);
    const serialized = JSON.stringify(value);

    const pipeline = this.redis.pipeline();
    pipeline.hset(fullKey, field, serialized);

    if (expirationSecs || this.config.expirationMs) {
      pipeline.pexpire(fullKey, expirationSecs || this.config.expirationMs);
    }

    await pipeline.exec();
  }

  public async getHashField<T>(
    key: string,
    field: string,
    provider?: () => Promise<T | null>,
  ): Promise<T | null> {
    const fullKey = this.getFullKey(key);
    const cached = await this.redis.hget(fullKey, field);

    if (cached) {
      try {
        return JSON.parse(cached) as T;
      }
      catch (error) {
        handleError(error, {
          comment: `Failed to parse cached hash field for key ${fullKey}:${field}`,
        });
      }
    }

    if (!provider) return null;

    const value = await provider();
    if (value !== null) {
      await this.setHashField(key, field, value);
    }
    return value;
  }

  public async deleteHashField(key: string, field: string): Promise<void> {
    await this.redis.hdel(this.getFullKey(key), field);
  }

  public async getHashFields<T>(
    key: string,
    provider?: () => Promise<Record<string, T>>,
  ): Promise<Record<string, T>> {
    const fullKey = this.getFullKey(key);
    const fields = await this.redis.hgetall(fullKey);

    if (Object.keys(fields).length > 0) {
      try {
        return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, JSON.parse(v) as T]));
      }
      catch (error) {
        handleError(error, { comment: `Failed to parse cached hash fields for key ${fullKey}:` });
      }
    }

    if (!provider) return {};

    const values = await provider();
    if (Object.keys(values).length > 0) {
      await this.setHashFields(key, values);
    }
    return values;
  }

  public async setHashFields<T>(
    key: string,
    fields: Record<string, T>,
    expirationSecs?: number,
  ): Promise<void> {
    const fullKey = this.getFullKey(key);
    const serialized = Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, JSON.stringify(v)]),
    );

    const pipeline = this.redis.pipeline();
    pipeline.hset(fullKey, serialized);

    if (expirationSecs) {
      pipeline.expire(fullKey, expirationSecs);
    }
    else if (this.config.expirationMs) {
      pipeline.pexpire(fullKey, this.config.expirationMs);
    }

    await pipeline.exec();
  }

  public async deleteHashFields(key: string, ...fields: string[]): Promise<void> {
    await this.redis.hdel(this.getFullKey(key), ...fields);
  }

  /**
   * Clears all cached data with the configured prefix
   */
  public async clear(): Promise<void> {
    if (!this.config.prefix) {
      throw new Error('Cannot clear cache without a prefix configured');
    }

    const keys = await this.redis.keys(`${this.config.prefix}:*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
