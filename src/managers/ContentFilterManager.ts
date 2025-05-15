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

import { prohibitedContent } from '#src/config/contentFilter.js';
import Logger from '#src/utils/Logger.js';
import { getRedis } from '#src/utils/Redis.js';
import { RedisKeys } from '#src/utils/Constants.js';
import type { Message } from 'discord.js';

/**
 * Result of a content filter check
 */
export interface ContentFilterResult {
  /** Whether the message contains prohibited content */
  blocked: boolean;

  /** The specific term that triggered the filter */
  matchedTerm?: string;
}

/**
 * Manages content filtering for InterChat calls
 */
export default class ContentFilterManager {
  private static instance: ContentFilterManager;
  private readonly CACHE_TTL = 60 * 60; // 1 hour in seconds

  /**
   * Get the singleton instance of ContentFilterManager
   */
  public static getInstance(): ContentFilterManager {
    if (!ContentFilterManager.instance) {
      ContentFilterManager.instance = new ContentFilterManager();
    }
    return ContentFilterManager.instance;
  }

  /**
   * Check if a message contains prohibited content
   * @param message The Discord message to check
   * @returns A ContentFilterResult object
   */
  public async checkMessage(message: Message<true>): Promise<ContentFilterResult> {
    const content = message.content.toLowerCase();

    // Skip empty messages
    if (!content.trim()) {
      return { blocked: false };
    }

    // Extract words from the message
    const wordsInMessage = new Set<string>(
      (content.match(/\b\w+\b/g) || [])
        .map((word) => word.toLowerCase().replace(/[^\w]/g, ''))
        .filter(Boolean),
    );

    // Check each term in the prohibited content list
    for (const term of prohibitedContent) {
      const normalizedTerm = term.toLowerCase();

      // Check for exact word matches
      if (wordsInMessage.has(normalizedTerm)) {
        await this.logBlockedMessage(message, normalizedTerm);
        return {
          blocked: true,
          matchedTerm: normalizedTerm,
        };
      }

      // Check for substring matches (for multi-word terms or terms with special characters)
      if (content.includes(normalizedTerm)) {
        await this.logBlockedMessage(message, normalizedTerm);
        return {
          blocked: true,
          matchedTerm: normalizedTerm,
        };
      }
    }

    return { blocked: false };
  }

  /**
   * Log a blocked message for moderation purposes
   * @param message The Discord message that was blocked
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async logBlockedMessage(message: Message<true>, _term: string): Promise<void> {
    try {
      const logData = {
        userId: message.author.id,
        username: message.author.username,
        channelId: message.channelId,
        guildId: message.guildId,
        messageId: message.id,
        timestamp: Date.now(),
        // Note: We don't log the actual content or the exact term to avoid storing prohibited content
      };

      // Log to console for debugging
      Logger.debug(`Content filter blocked message: ${JSON.stringify(logData)}`);

      // Store in Redis for temporary tracking (24 hours)
      const redis = getRedis();
      const key = `${RedisKeys.ContentFilter}:blocked:${message.id}`;
      await redis.set(key, JSON.stringify(logData), 'EX', 24 * 60 * 60);

      // Increment blocked message count for this user
      const userCountKey = `${RedisKeys.ContentFilter}:user:${message.author.id}:count`;
      await redis.incr(userCountKey);
      await redis.expire(userCountKey, this.CACHE_TTL);
    }
    catch (error) {
      Logger.error('Failed to log blocked message:', error);
    }
  }
}
