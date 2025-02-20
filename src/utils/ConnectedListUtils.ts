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

import Context, {
  CacheContext,
} from '#src/core/CommandContext/Context.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { supportedLocaleCodes, t } from '#src/utils/Locale.js';
import Logger from '#src/utils/Logger.js';
import { createServerInvite, getReplyMethod, handleError } from '#src/utils/Utils.js';
import type { ConvertDatesToString } from '#types/Utils.d.ts';
import { RedisKeys } from '#utils/Constants.js';
import db from '#utils/Db.js';
import getRedis from '#utils/Redis.js';
import type { Connection, Prisma } from '@prisma/client';
import { MessageComponentInteraction, RepliableInteraction } from 'discord.js';
import isEmpty from 'lodash/isEmpty.js';

type whereUniuqeInput = Prisma.ConnectionWhereUniqueInput;
type whereInput = Prisma.ConnectionWhereInput;
type dataInput = Prisma.ConnectionUpdateInput;
type CachedConnection = ConvertDatesToString<Connection>;

export const convertToConnectedList = (connection: CachedConnection): Connection => ({
  ...connection,
  createdAt: new Date(connection.createdAt),
  lastActive: new Date(connection.lastActive),
});

/**
 * This includes both connected and disconnected connections
 */
export const getHubConnections = async (hubId: string): Promise<Connection[]> => {
  const redis = getRedis();
  const key = `${RedisKeys.Hub}:${hubId}:connections`;
  const cached = await redis.hgetall(key);

  if (isEmpty(cached) === false) {
    const cachedData = Object.values(cached).map((c) => convertToConnectedList(JSON.parse(c)));
    return cachedData;
  }

  const fromDb = await db.connection.findMany({ where: { hubId } });
  const keyValuePairs = fromDb.flatMap((c) => [c.channelId, JSON.stringify(c)]);

  if (keyValuePairs.length === 0) return [];

  Logger.debug(`Caching ${fromDb.length} connections for hub ${hubId}`);

  await redis.hset(key, keyValuePairs);
  await redis.expire(key, 10 * 60 * 1000); // 10 minutes

  Logger.debug(`Cached ${fromDb.length} connections for hub ${hubId}`);

  return fromDb;
};

export const cacheHubConnection = async (connection: Connection) => {
  const redis = getRedis();
  const cached = await redis.hlen(`${RedisKeys.Hub}:${connection.hubId}:connections`);

  Logger.debug(`Caching connection ${connection.channelId} for hub ${connection.hubId}`);

  if (!cached) {
    Logger.debug(`No cached connections for hub ${connection.hubId}, fetching from database`);
    await getHubConnections(connection.hubId);
    Logger.debug(`Fetched connections for hub ${connection.hubId}`);
    return;
  }

  await getRedis().hset(
    `${RedisKeys.Hub}:${connection.hubId}:connections`,
    connection.channelId,
    JSON.stringify(connection),
  );

  Logger.debug(`Cached connection ${connection.channelId} for hub ${connection.hubId}`);
};

const removeFromHubConnections = async (connId: string, hubId: string) => {
  await getRedis().hdel(`${RedisKeys.Hub}:${hubId}:connections`, connId);
};

const removeConnectionHubId = async (channelId: string) => {
  await getRedis().del(`${RedisKeys.connectionHubId}:${channelId}`);
};

const cacheConnectionHubId = async (...connections: Connection[]) => {
  const redis = getRedis();
  const pipeline = redis.pipeline();

  for (const c of connections) {
    const key = `${RedisKeys.connectionHubId}:${c.channelId}`;

    if (!c.connected) pipeline.del(key);
    else pipeline.set(key, c.hubId);
  }

  await pipeline.exec().catch((e) => {
    handleError(e, { comment: 'Failed to cache connectionHubId' });
  });
};

export const fetchConnection = async (channelId: string) => {
  const connection = await db.connection.findFirst({ where: { channelId } });
  if (!connection) return null;

  await cacheConnectionHubId(connection);
  await cacheHubConnection(connection);

  return connection;
};

export const getConnectionHubId = async (channelId: string) => {
  const hubId = await getRedis().get(`${RedisKeys.connectionHubId}:${channelId}`);
  if (hubId) return hubId;

  const connection = await fetchConnection(channelId);
  if (!connection) return null;

  await cacheConnectionHubId(connection);
  return connection.hubId;
};

export const deleteConnection = async (where: whereUniuqeInput) => {
  const connection = await db.connection.findFirst({ where });
  if (!connection) return null;

  const deleted = await db.connection.delete({ where });
  await removeFromHubConnections(deleted.channelId, deleted.hubId);
  await removeConnectionHubId(deleted.channelId);
  return deleted;
};

export const createConnection = async (data: Prisma.ConnectionCreateInput) => {
  const connection = await db.connection.create({ data });
  await cacheConnectionHubId(connection);
  await cacheHubConnection(connection);

  return connection;
};

export const deleteConnections = async (where: whereInput) => {
  const connections = await db.connection.findMany({ where });
  if (connections.length === 0) {
    return [];
  }
  if (connections.length === 1) {
    return [await deleteConnection({ id: connections[0].id })];
  }

  await db.connection.deleteMany({
    where: { id: { in: connections.map((i) => i.id) } },
  });

  // repopulate cache
  connections.forEach(async (connection) => {
    await removeFromHubConnections(connection.channelId, connection.hubId);
    await removeConnectionHubId(connection.channelId);
  });

  return connections;
};

export const updateConnection = async (where: whereUniuqeInput, data: dataInput) => {
  const conn = await db.connection.findFirst({ where });
  if (!conn) return null;

  // Update in database
  const connection = await db.connection.update({ where, data });

  // Update cache
  await cacheConnectionHubId(connection);
  await cacheHubConnection(connection);

  return connection;
};

// TODO: test this function
export const updateConnections = async (where: whereInput, data: dataInput) => {
  const connectionIds = db.connection
    .findMany({ where, select: { id: true } })
    .then((connections) => connections.map(({ id }) => id));

  // Update in database
  const updated = await db.connection.updateMany({ where, data });

  connectionIds.then(async (ids) => {
    const updatedConnections = await db.connection.findMany({
      where: { id: { in: ids } },
    });

    await cacheConnectionHubId(...updatedConnections);
    updatedConnections.forEach(cacheHubConnection);
  });

  return updated;
};

export const sendInviteCreatedResponse = async (
  interaction: RepliableInteraction | Context | MessageComponentInteraction,
  success: boolean,
  locale: supportedLocaleCodes,
): Promise<void> => {
  const messageKey = success ? 'connection.inviteAdded' : 'connection.setInviteError';
  const emojiKey = success ? 'tick_icon' : 'x_icon';

  const data = {
    flags: ['Ephemeral'],
    content: t(messageKey, locale, {
      emoji: getEmoji(emojiKey, interaction.client),
    }),
  } as const;

  await (interaction instanceof Context
    ? interaction.reply(data)
    : interaction[getReplyMethod(interaction)](data));
};

/**
 * @returns The invite code if the invite was created successfully
 */
export const handleConnectionInviteCreation = async (
  interaction:
    | RepliableInteraction<'cached'>
    | Context<CacheContext>
    | MessageComponentInteraction<'cached'>,
  connection: Connection,
  locale: supportedLocaleCodes,
): Promise<string | undefined> => {
  const { channelId } = connection;
  const { success, inviteUrl: invite } = await createServerInvite(
    channelId,
    interaction.guild,
    interaction.user.username,
  );

  if (success && invite) {
    await updateConnection({ channelId }, { invite });
  }

  await sendInviteCreatedResponse(interaction, success, locale);
  return invite;
};
