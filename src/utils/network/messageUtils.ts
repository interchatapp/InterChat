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

import messageService from '#src/services/MessageService.js';
import Logger from '#src/utils/Logger.js';
import getRedis from '#src/utils/Redis.js';
import { RedisKeys } from '#utils/Constants.js';
import type { Message, Snowflake } from 'discord.js';
import type { Broadcast, Message as MessageDB } from '#src/generated/prisma/client/client.js';

export const storeMessage = async (
  originalMsgId: string,
  messageData: Omit<MessageDB, 'reactions'> & { reactions?: { [key: string]: string[] } },
) => {
  await messageService.storeMessage(originalMsgId, messageData);
};

/**
 * Get the original message from the database.
 *
 * @see {@link findOriginalMessage} for a more flexible method.
 * @param originalMsgId The original message ID
 * @returns Original Message Object from database
 */
export const getOriginalMessage = async (originalMsgId: string) =>
  await messageService.getOriginalMessage(originalMsgId);

export const addBroadcasts = async (originalMsgId: Snowflake, ...broadcasts: Broadcast[]) => {
  try {
    Logger.debug(`Adding ${broadcasts.length} broadcasts for message ${originalMsgId}`);

    await messageService.addBroadcasts(originalMsgId, ...broadcasts);

    Logger.debug(`Added ${broadcasts.length} broadcasts for message ${originalMsgId}`);
  }
  catch (error) {
    Logger.error('Failed to add broadcasts', error);
  }
};

export const getBroadcasts = async (originalMsgId: string) =>
  await messageService.getBroadcasts(originalMsgId);

export const getBroadcast = async (originalMsgId: string, find: { channelId: string }) =>
  await messageService.getBroadcast(originalMsgId, find);

/**
 * Retrieves the original message given a message ID, accepting both original and broadcast message IDs.
 *
 * This function first attempts to find the original message using the provided ID.
 * If the original message is not found, it looks up the original message using a broadcast relationship in PostgreSQL.
 *
 * Different from {@link getOriginalMessage}.
 * This finds the original message even if you provide a broadcasted message's ID.
 *
 * @param messageId - The ID of the message to find the original for
 * @returns Promise that resolves to the original message object
 */
export const findOriginalMessage = async (messageId: string) =>
  await messageService.findOriginalMessage(messageId);

export const storeMessageTimestamp = async (message: Message) => {
  Logger.debug(`Storing message timestamp for channel ${message.channelId}`);
  await getRedis().hset(`${RedisKeys.msgTimestamp}`, message.channelId, message.createdTimestamp);
  Logger.debug(`Stored message timestamp for channel ${message.channelId}`);
};

/**
 * Deletes the message data from the database associated with a given original message.
 *
 * This function deletes the message and all its associated broadcasts from the database.
 * The broadcasts are deleted automatically due to the cascade delete relationship.
 *
 * @param originalMsgId - The unique identifier (Snowflake) of the original message to be deleted.
 * @returns A promise that resolves to the number of records deleted.
 */
export const deleteMessageCache = async (originalMsgId: Snowflake) =>
  await messageService.deleteMessage(originalMsgId);
