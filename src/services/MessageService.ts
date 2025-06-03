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

import db from '#src/utils/Db.js';
import Logger from '#src/utils/Logger.js';
import type {
  Broadcast,
  Prisma,
  Message as MessageDB,
} from '#src/generated/prisma/client/client.js';
import type { Snowflake } from 'discord.js';

/**
 * Service for managing message data in PostgreSQL.
 * Replaces the Redis-based message storage system.
 */
export class MessageService {
  /**
   * Stores a message in the database.
   *
   * @param originalMsgId - The ID of the original message
   * @param messageData - The message data to store
   */
  async storeMessage(
    originalMsgId: string,
    messageData: Omit<MessageDB, 'reactions'> & { reactions?: { [key: string]: string[] } },
  ): Promise<void> {
    try {
      await db.message.upsert({
        where: { id: originalMsgId },
        update: {
          content: messageData.content,
          imageUrl: messageData.imageUrl,
          reactions: messageData.reactions ? messageData.reactions : undefined,
          referredMessageId: messageData.referredMessageId,
        },
        create: {
          id: originalMsgId,
          hubId: messageData.hubId,
          content: messageData.content,
          imageUrl: messageData.imageUrl,
          channelId: messageData.channelId,
          guildId: messageData.guildId,
          authorId: messageData.authorId,
          createdAt: messageData.createdAt,
          reactions: messageData.reactions ? messageData.reactions : undefined,
          referredMessageId: messageData.referredMessageId,
        },
      });
    }
    catch (error) {
      Logger.error('Failed to store message in database:', error);
      throw error;
    }
  }

  /**
   * Gets the original message from the database.
   *
   * @param originalMsgId - The ID of the original message
   * @returns The original message or null if not found
   */
  async getOriginalMessage(originalMsgId: string): Promise<MessageDB | null> {
    try {
      const message = await db.message.findUnique({
        where: { id: originalMsgId },
      });

      if (!message) return null;

      return {
        id: message.id,
        hubId: message.hubId,
        content: message.content,
        imageUrl: message.imageUrl,
        channelId: message.channelId,
        guildId: message.guildId,
        authorId: message.authorId,
        createdAt: message.createdAt,
        reactions: message.reactions as string,
        referredMessageId: message.referredMessageId || null,
      };
    }
    catch (error) {
      Logger.error('Failed to get original message from database:', error);
      return null;
    }
  }

  /**
   * Adds broadcasts to the database.
   *
   * @param hubId - The ID of the hub
   * @param originalMsgId - The ID of the original message
   * @param broadcasts - The broadcasts to add
   */
  async addBroadcasts(originalMsgId: Snowflake, ...broadcasts: Broadcast[]): Promise<void> {
    try {
      // Create all broadcasts in a single transaction
      await db.$transaction(
        broadcasts.map((broadcast) => {
          const { id: broadcastMessageId, channelId, mode } = broadcast;
          return db.broadcast.create({
            data: {
              id: broadcastMessageId,
              messageId: originalMsgId,
              channelId,
              mode,
            },
          });
        }),
      );
    }
    catch (error) {
      Logger.error('Failed to add broadcasts to database:', error);
      throw error;
    }
  }

  /**
   * Gets all broadcasts for a message.
   *
   * @param originalMsgId - The ID of the original message
   * @param hubId - The ID of the hub (used for compatibility with old API)
   * @returns A record of broadcasts by channel ID
   */
  async getBroadcasts(originalMsgId: string): Promise<Broadcast[]> {
    try {
      const broadcasts = await db.broadcast.findMany({
        where: { messageId: originalMsgId },
      });

      return broadcasts;
    }
    catch (error) {
      Logger.error('Failed to get broadcasts from database:', error);
      return [];
    }
  }

  /**
   * Gets a specific broadcast for a message.
   *
   * @param originalMsgId - The ID of the original message
   * @param find - The criteria to find the broadcast
   * @returns The broadcast or null if not found
   */
  async getBroadcast(
    originalMsgId: string,
    find: { channelId: string },
  ): Promise<Broadcast | null> {
    try {
      const broadcast = await db.broadcast.findFirst({
        where: {
          messageId: originalMsgId,
          channelId: find.channelId,
        },
      });

      if (!broadcast) return null;

      return broadcast;
    }
    catch (error) {
      Logger.error('Failed to get broadcast from database:', error);
      return null;
    }
  }

  /**
   * Finds the original message given a message ID, accepting both original and broadcast message IDs.
   *
   * @param messageId - The ID of the message to find the original for
   * @returns The original message or null if not found
   */
  async findOriginalMessage(messageId: string): Promise<MessageDB | null> {
    try {
      // First try to get the message directly
      const message = await this.getOriginalMessage(messageId);
      if (message) return message;

      // If not found, check if it's a broadcast message
      const broadcast = await db.broadcast.findUnique({
        where: { id: messageId },
        select: { message: true, id: true },
      });

      if (!broadcast) return null;

      return broadcast.message;
    }
    catch (error) {
      Logger.error('Failed to find original message in database:', error);
      return null;
    }
  }

  /**
   * Deletes a message and all its broadcasts from the database.
   *
   * @param originalMsgId - The ID of the original message
   * @returns The number of records deleted
   */
  async deleteMessage(originalMsgId: string): Promise<number> {
    try {
      // The broadcasts will be deleted automatically due to the cascade delete
      const result = await db.message.delete({
        where: { id: originalMsgId },
      });

      return result ? 1 : 0;
    }
    catch (error) {
      Logger.error('Failed to delete message from database:', error);
      return 0;
    }
  }

  /**
   * Stores message reactions in the database.
   *
   * @param originalMessage - The original message
   * @param reactions - The reactions to store
   */
  async storeReactions(
    originalMessage: MessageDB,
    reactions: { [key: string]: string[] },
  ): Promise<void> {
    try {
      await db.message.update({
        where: { id: originalMessage.id },
        data: {
          reactions: reactions as Prisma.InputJsonValue,
        },
      });
    }
    catch (error) {
      Logger.error('Failed to store reactions in database:', error);
      throw error;
    }
  }

  /**
   * Deletes messages older than the specified age.
   *
   * @param ageInHours - The age in hours
   * @returns The number of messages deleted
   */
  async deleteOldMessages(ageInHours: number = 24): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - ageInHours * 60 * 60 * 1000);

      const result = await db.message.deleteMany({
        where: {
          AND: [
            { referredMessageId: null },
            { broadcasts: { none: {} } },
            { reports: { none: {} } },
          ],
          createdAt: {
            lt: cutoffDate,
          },
        },
      });

      return result.count;
    }
    catch (error) {
      Logger.error('Failed to delete old messages from database:', error);
      return 0;
    }
  }
}

// Export a singleton instance
export default new MessageService();
