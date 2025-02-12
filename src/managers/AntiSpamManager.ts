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

  public async handleMessage(message: Message): Promise<UserMessageInfo | null> {
    const userId = message.author.id;
    const currentTime = Date.now();
    const userInfo = await this.getUserInfo(userId);

    if (currentTime - userInfo.lastMessage < this.config.timeWindow) {
      userInfo.messageCount++;
      if (userInfo.messageCount >= this.config.spamThreshold) {
        this.setUserInfo(userId, { ...userInfo, lastMessage: currentTime });
        return userInfo;
      }
    }
    else {
      userInfo.messageCount = 1;
    }

    this.setUserInfo(userId, { ...userInfo, lastMessage: currentTime });
    return null;
  }

  private async getUserInfo(userId: string): Promise<UserMessageInfo> {
    const data = await this.cache.get<UserMessageInfo>(userId);
    return data ?? { messageCount: 0, lastMessage: 0 };
  }

  private async setUserInfo(userId: string, info: UserMessageInfo): Promise<void> {
    await this.cache.set(userId, info);
  }
}
