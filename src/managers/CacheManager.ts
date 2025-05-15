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
  expirationMs?: number; // Default expiration for keys in milliseconds
  prefix?: string; // Prefix for all keys managed by this instance
}

/**
 * A generic manager for interacting with a Redis cache.
 * It simplifies common caching patterns like get-or-set, and operations on
 * various Redis data types (strings, sets, hashes).
 */
export class CacheManager {
  public readonly redis: Redis;
  private readonly config: Required<CacheConfig>; // All config options will have a value
  private static readonly DEFAULT_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes

  constructor(redisInstance?: Redis, config: CacheConfig = {}) {
    this.redis = redisInstance ?? getRedis();
    this.config = {
      expirationMs: config.expirationMs ?? CacheManager.DEFAULT_EXPIRATION_MS,
      prefix: config.prefix ?? '', // Default to no prefix
    };
  }

  private getFullKey(key: string): string {
    return this.config.prefix ? `${this.config.prefix}:${key}` : key;
  }

  /**
   * Gets a value from the cache. If the key is not found and a `provider` function
   * is supplied, it calls the provider, stores its result in the cache, and returns it.
   * @param key The cache key.
   * @param provider An optional async function to fetch the value if not in cache.
   * @returns The cached or freshly fetched value, or null.
   */
  public async get<T>(
    key: string,
    provider?: () => Promise<T | null>,
  ): Promise<ConvertDatesToString<T> | null> {
    const fullKey = this.getFullKey(key);
    const cachedValue = await this.redis.get(fullKey);

    if (cachedValue !== null) {
      // Check for null specifically, as empty string is a valid value
      try {
        return JSON.parse(cachedValue) as ConvertDatesToString<T>;
      }
      catch (error) {
        handleError(error, {
          comment: `Failed to parse cached JSON for key ${fullKey}. Raw: "${cachedValue}"`,
        });
        // delete the corrupted cache entry
        // and fall through to provider if it exists.
        await this.delete(key);
      }
    }

    if (!provider) return null;

    const valueFromProvider = await provider();
    if (valueFromProvider !== null) {
      await this.set(key, valueFromProvider); // Uses default expiration
    }
    // Ensure Date objects are handled as strings
    return valueFromProvider as ConvertDatesToString<T>;
  }

  /**
   * Sets a value in the cache.
   * @param key The cache key.
   * @param value The value to store (will be JSON.stringify'd).
   * @param expirationSecs Optional expiration time in seconds for this specific key.
   *                       Overrides the default expiration.
   */
  public async set(key: string, value: unknown, expirationSecs?: number): Promise<void> {
    const fullKey = this.getFullKey(key);
    const serializedValue = JSON.stringify(value);

    if (expirationSecs !== undefined) {
      await this.redis.setex(fullKey, expirationSecs, serializedValue);
    }
    else if (this.config.expirationMs > 0) {
      // Use psetex if default expiration is set
      await this.redis.psetex(fullKey, this.config.expirationMs, serializedValue);
    }
    else {
      // No expiration
      await this.redis.set(fullKey, serializedValue);
    }
  }

  /**
   * Deletes a key (and its value) from the cache.
   * @param key The cache key to delete.
   */
  public async delete(key: string): Promise<void> {
    await this.redis.del(this.getFullKey(key));
  }

  // --- Set Operations ---

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
    if (values.length > 0) await this.setSetMembers(key, values);
    return values;
  }

  public async setSetMembers<T>(key: string, members: T[], expirationSecs?: number): Promise<void> {
    const fullKey = this.getFullKey(key);
    const pipeline = this.redis.pipeline();
    pipeline.del(fullKey); // Clear existing set first

    if (members.length > 0) {
      const serializedMembers = members.map((m) => JSON.stringify(m));
      pipeline.sadd(fullKey, ...serializedMembers);

      if (expirationSecs !== undefined) {
        pipeline.expire(fullKey, expirationSecs);
      }
      else if (this.config.expirationMs > 0) {
        pipeline.pexpire(fullKey, this.config.expirationMs);
      }
    }
    try {
      await pipeline.exec();
    }
    catch (error) {
      handleError(error, { comment: `Failed to set set members for key ${fullKey}` });
    }
  }

  public async addSetMember<T>(key: string, member: T): Promise<void> {
    await this.redis.sadd(this.getFullKey(key), JSON.stringify(member));
  }

  public async removeSetMember<T>(key: string, member: T): Promise<void> {
    await this.redis.srem(this.getFullKey(key), JSON.stringify(member));
  }

  // --- Hash Operations ---

  /**
   * Sets a field in a hash.
   * @param key The cache key (for the hash).
   * @param field The field in the hash to set.
   * @param value The value to store (will be JSON.stringify'd).
   * @param expirationSecs Optional expiration time in seconds for the entire hash.
   *                       Overrides the default expiration.
   */
  public async setHashField<T>(
    key: string,
    field: string,
    value: T,
    expirationSecs?: number, // Expiration for the entire hash key, not just the field
  ): Promise<void> {
    const fullKey = this.getFullKey(key);
    const pipeline = this.redis.pipeline();
    pipeline.hset(fullKey, field, JSON.stringify(value));

    if (expirationSecs !== undefined) {
      pipeline.expire(fullKey, expirationSecs);
    }
    else if (this.config.expirationMs > 0 && (await this.redis.ttl(fullKey)) === -1) {
      // Only set default expiration if an explicit one isn't given AND the key has no TTL
      // This prevents overriding a specific TTL set elsewhere on the hash.
      pipeline.pexpire(fullKey, this.config.expirationMs);
    }
    try {
      await pipeline.exec();
    }
    catch (error) {
      handleError(error, { comment: `Failed to set hash field ${field} for key ${fullKey}` });
    }
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
          comment: `Failed to parse cached hash field ${field} for key ${fullKey}`,
        });
      }
    }
    if (!provider) return null;
    const value = await provider();
    if (value !== null) await this.setHashField(key, field, value); // Uses default expiration logic for hash
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
        const parsedFields: Record<string, T> = {};
        for (const [k, v] of Object.entries(fields)) {
          parsedFields[k] = JSON.parse(v) as T;
        }
        return parsedFields;
      }
      catch (error) {
        handleError(error, {
          comment: `Failed to parse one or more cached hash fields for key ${fullKey}`,
        });
      }
    }
    if (!provider) return {};
    const values = await provider();
    if (Object.keys(values).length > 0) await this.setHashFields(key, values);
    return values;
  }

  public async setHashFields<T>(
    key: string,
    fields: Record<string, T>,
    expirationSecs?: number,
  ): Promise<void> {
    const fullKey = this.getFullKey(key);
    if (Object.keys(fields).length === 0) return; // Nothing to set

    const serializedFields: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      serializedFields[k] = JSON.stringify(v);
    }

    const pipeline = this.redis.pipeline();
    pipeline.hmset(fullKey, serializedFields); // set multiple hash fields in one go

    if (expirationSecs !== undefined) {
      pipeline.expire(fullKey, expirationSecs);
    }
    else if (this.config.expirationMs > 0) {
      pipeline.pexpire(fullKey, this.config.expirationMs);
    }
    await pipeline.exec();
  }

  public async deleteHashFields(key: string, ...fields: string[]): Promise<void> {
    if (fields.length === 0) return;
    await this.redis.hdel(this.getFullKey(key), ...fields);
  }

  /**
   * Clears all cached data that matches the configured prefix.
   */
  public async clear(): Promise<void> {
    if (!this.config.prefix) {
      // To prevent accidental clearing of non-prefixed keys if prefix is empty.
      throw new Error('Cannot clear cache without a prefix configured');
    }

    let cursor = '0';
    do {
      const [nextCursor, keysInBatch] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.config.prefix}:*`,
        'COUNT',
        100,
      );
      if (keysInBatch.length > 0) await this.redis.del(...keysInBatch);
      cursor = nextCursor;
    } while (cursor !== '0');
  }

  /**
   * Gets the remaining time to live in milliseconds for a key.
   * @param key The cache key.
   * @returns The TTL in milliseconds, or null if the key doesn't exist or has no expiry.
   */
  public async getTTL(key: string): Promise<number | null> {
    const fullKey = this.getFullKey(key);
    const ttl = await this.redis.pttl(fullKey);
    // PTTL returns:
    // - positive number: remaining time in ms
    // - -1: key exists but has no associated expire
    // - -2: key does not exist
    return ttl > 0 ? ttl : null;
  }
}
