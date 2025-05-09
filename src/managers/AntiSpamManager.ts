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

import type { Message } from 'discord.js';
import getRedis from '#src/utils/Redis.js';
import { CacheManager } from '#src/managers/CacheManager.js';
import { RedisKeys } from '#src/utils/Constants.js';
import Logger from '#src/utils/Logger.js';

interface UserMessageInfo {
  messageCount: number;
  lastMessage: number;
}

interface SpamConfig {
  spamThreshold: number;
  timeWindow: number;
  spamCountExpirySecs: number;
}

export default class AntiSpamManager {
  private config: SpamConfig;
  private readonly cache: CacheManager;

  constructor(config: SpamConfig, redis = getRedis()) {
    this.config = config;
    this.cache = new CacheManager(redis, {
      prefix: RedisKeys.Spam,
      expirationMs: config.spamCountExpirySecs * 1000,
    });
  }

  /**
   * Handle a message and check if it's spam
   * @param message The message to check
   * @returns User message info if spam detected, null otherwise
   */
  public async handleMessage(message: Message): Promise<UserMessageInfo | null> {
    const userId = message.author.id;
    const currentTime = Date.now();
    const userInfo = await this.getUserInfo(userId);

    if (currentTime - userInfo.lastMessage < this.config.timeWindow) {
      userInfo.messageCount++;
      if (userInfo.messageCount >= this.config.spamThreshold) {
        await this.setUserInfo(userId, { ...userInfo, lastMessage: currentTime });
        return userInfo;
      }
    }
    else {
      userInfo.messageCount = 1;
    }

    this.setUserInfo(userId, { ...userInfo, lastMessage: currentTime });
    return null;
  }

  /**
   * Get user message info from Redis
   * @param userId The user ID to get info for
   * @returns The user message info
   */
  private async getUserInfo(userId: string): Promise<UserMessageInfo> {
    try {
      // Get data directly from Redis cache
      const data = await this.cache.get<UserMessageInfo>(userId);
      return data ?? { messageCount: 0, lastMessage: 0 };
    }
    catch (error) {
      Logger.error('Error getting user info from Redis:', error);
      // Return default values in case of error
      return { messageCount: 0, lastMessage: 0 };
    }
  }

  /**
   * Set user message info in Redis
   * @param userId The user ID to set info for
   * @param info The user message info to set
   */
  private async setUserInfo(userId: string, info: UserMessageInfo): Promise<void> {
    try {
      // Set data directly in Redis with the configured TTL
      await this.cache.set(userId, info);
    }
    catch (error) {
      Logger.error('Error setting user info in Redis:', error);
    }
  }
}
