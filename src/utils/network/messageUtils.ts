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

import type { Message, Snowflake } from 'discord.js';
import isEmpty from 'lodash/isEmpty.js';
import Logger from '#src/utils/Logger.js';
import getRedis from '#src/utils/Redis.js';
import { handleError } from '#src/utils/Utils.js';
import { RedisKeys } from '#utils/Constants.js';

export interface OriginalMessage {
  hubId: string;
  content: string;
  imageUrl: string | null;
  messageId: string;
  channelId: string;
  guildId: string;
  authorId: string;
  timestamp: number;
  reactions?: string; // { [key: string]: Snowflake[] };
  referredMessageId?: string;
}

export interface Broadcast {
  mode: number;
  messageId: string;
  channelId: string;
  originalMsgId: string;
}

export const storeMessage = async (
  originalMsgId: string,
  messageData: Omit<OriginalMessage, 'reactions'> & { reactions?: { [key: string]: string[] } },
) => {
  const key = `${RedisKeys.message}:${originalMsgId}`;
  const redis = getRedis();

  await redis.hset(key, { ...messageData, reactions: JSON.stringify(messageData.reactions) });
  await redis.expire(key, 86400); // 1 day in seconds
};

/**
 * Get the original message from the cache.
 *
 * @see {@link findOriginalMessage} for a more flexible method.
 * @param originalMsgId The original message ID
 * @returns Original Message Object from redis
 */
export const getOriginalMessage = async (originalMsgId: string) => {
  const key = `${RedisKeys.message}:${originalMsgId}`;
  const res = await getRedis().hgetall(key);

  if (isEmpty(res)) return null;

  return {
    ...res,
    timestamp: Number.parseInt(res.timestamp),
  } as OriginalMessage;
};

export const addBroadcasts = async (
  hubId: string,
  originalMsgId: Snowflake,
  ...broadcasts: Broadcast[]
) => {
  try {
    const redis = getRedis();
    const broadcastsKey = `${RedisKeys.broadcasts}:${originalMsgId}:${hubId}`;
    const pipeline = redis.pipeline();

    // Prepare all operations in a single reduce to minimize iterations
    const { broadcastEntries, reverseLookupKeys } = broadcasts.reduce(
      (acc, broadcast) => {
        const { messageId, channelId, mode } = broadcast;
        const broadcastInfo = JSON.stringify({
          mode,
          messageId,
          channelId,
          originalMsgId,
        });

        // Add to broadcasts entries
        acc.broadcastEntries.push(channelId, broadcastInfo);

        // Store reverse lookup key for later expiry setting
        const reverseKey = `${RedisKeys.messageReverse}:${messageId}`;
        acc.reverseLookupKeys.push(reverseKey);

        // Add reverse lookup to pipeline
        pipeline.set(reverseKey, `${originalMsgId}:${hubId}`);

        return acc;
      },
      {
        broadcastEntries: [] as string[],
        reverseLookupKeys: [] as string[],
      },
    );

    Logger.debug(`Adding ${broadcasts.length} broadcasts for message ${originalMsgId}`);

    // Add main broadcast hash
    pipeline.hset(broadcastsKey, broadcastEntries);
    pipeline.expire(broadcastsKey, 86400);

    // Set expiry for all reverse lookups in the same pipeline
    for (const key of reverseLookupKeys) {
      pipeline.expire(key, 86400);
    }

    // Execute all Redis operations in a single pipeline
    await pipeline.exec().catch((error) => {
      handleError(error, { comment: 'Failed to add broadcasts' });
    });

    Logger.debug(`Added ${broadcasts.length} broadcasts for message ${originalMsgId}`);
  }
  catch (error) {
    Logger.error('Failed to add broadcasts', error);
  }
};

export const getBroadcasts = async (originalMsgId: string, hubId: string) => {
  const key = `${RedisKeys.broadcasts}:${originalMsgId}:${hubId}`;
  const broadcasts = await getRedis().hgetall(key);
  const entries = Object.entries(broadcasts);

  // Parse the JSON strings back into objects
  return Object.fromEntries(entries.map(([k, v]) => [k, JSON.parse(v)])) as Record<
    string,
    Broadcast
  >;
};

export const getBroadcast = async (
  originalMsgId: string,
  hubId: string,
  find: { channelId: string },
) => {
  const broadcast = await getRedis().hget(
    `${RedisKeys.broadcasts}:${originalMsgId}:${hubId}`,
    find.channelId,
  );
  return broadcast ? (JSON.parse(broadcast) as Broadcast) : null;
};

/**
 * Retrieves the original message given a message ID, accepting both original and broadcast message IDs.
 *
 * This function first attempts to find the original message using the provided ID.
 * If the original message is not found, it looks up the original message using a broadcast reverse lookup in Redis.
 *
 * Different from {@link getOriginalMessage}.
 * This finds the original message even if you provide a broadcasted message's ID.
 * However, this uses {@link getOriginalMessage} internally.
 *
 * @param messageId - The ID of the message to find the original for
 * @returns Promise that resolves to the original message object
 */
export const findOriginalMessage = async (messageId: string) => {
  const fetched = await getOriginalMessage(messageId);
  if (fetched) return fetched;

  // get the original messageId from a broadcast messageId
  const lookup = await getRedis().get(`${RedisKeys.messageReverse}:${messageId}`);
  if (!lookup) return null;

  const [originalMsgId] = lookup.split(':');
  return await getOriginalMessage(originalMsgId);
};

export const storeMessageTimestamp = async (message: Message) => {
  Logger.debug(`Storing message timestamp for channel ${message.channelId}`);
  await getRedis().hset(`${RedisKeys.msgTimestamp}`, message.channelId, message.createdTimestamp);
  Logger.debug(`Stored message timestamp for channel ${message.channelId}`);
};

/**
 * Deletes the cached message data from Redis associated with a given original message.
 *
 * This function retrieves the original message based on the provided message ID. If the original message exists,
 * it deletes the associated broadcasts, reverse lookup entries, and the original message from Redis.
 *
 * @param originalMsgId - The unique identifier (Snowflake) of the original message to be deleted.
 * @returns A promise that resolves to the number of keys that were deleted from Redis.
 */
export const deleteMessageCache = async (originalMsgId: Snowflake) => {
  const redis = getRedis();
  const original = await getOriginalMessage(originalMsgId);
  if (!original) return 0;

  // delete broadcats, reverse lookups and original message
  const broadcats = Object.values(await getBroadcasts(originalMsgId, original.hubId));
  await redis.del(`${RedisKeys.broadcasts}:${originalMsgId}:${original.hubId}`);
  await redis.del(broadcats.map((b) => `${RedisKeys.messageReverse}:${b.messageId}`)); // multi delete
  const count = await redis.del(`${RedisKeys.message}:${originalMsgId}`);

  return count;
};
