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

import Context from '#src/core/CommandContext/Context.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import type { Connection, Prisma } from '#src/generated/prisma/client/client.js';
import { MessageProcessor } from '#src/services/MessageProcessor.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { supportedLocaleCodes, t } from '#src/utils/Locale.js';
import { createServerInvite, getReplyMethod } from '#src/utils/Utils.js';
import db from '#utils/Db.js';
import { MessageComponentInteraction, RepliableInteraction } from 'discord.js';

type whereUniuqeInput = Prisma.ConnectionWhereUniqueInput;
type whereInput = Prisma.ConnectionWhereInput;
type dataInput = Prisma.ConnectionUpdateInput;
/**
 * This includes both connected and disconnected connections
 */
export const getHubConnections = async (hubId: string): Promise<Connection[]> => {
  const fromDb = await db.connection.findMany({ where: { hubId } });

  return fromDb;
};

export const fetchConnection = async (channelId: string, hubId?: string) => {
  const where = hubId ? { channelId, hubId } : { channelId };
  const connection = await db.connection.findFirst({ where });

  return connection;
};

export const deleteConnection = async (where: whereUniuqeInput) => {
  const connection = await db.connection.findUnique({ where });
  if (!connection) return null;

  const deleted = await db.connection.delete({ where });

  // Invalidate cache for this connection and all channels in the hub
  if (connection.channelId) {
    await MessageProcessor.onConnectionModified(connection.channelId, connection.hubId);
  }

  return deleted;
};

export const createConnection = async (data: Prisma.ConnectionCreateInput) => {
  const connection = await db.connection.create({ data });
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

  // Group connections by hubId for efficient cache invalidation
  const connectionsByHub = new Map<string, string[]>();

  for (const conn of connections) {
    if (!conn.channelId) continue;

    if (!connectionsByHub.has(conn.hubId)) {
      connectionsByHub.set(conn.hubId, []);
    }
    connectionsByHub.get(conn.hubId)?.push(conn.channelId);
  }

  await db.connection.deleteMany({
    where: { id: { in: connections.map((i) => i.id) } },
  });

  // Invalidate cache for each hub and its connections
  for (const [hubId, channelIds] of connectionsByHub.entries()) {
    // Invalidate the first channel with the hubId to trigger hub-wide invalidation
    if (channelIds.length > 0) {
      await MessageProcessor.onConnectionModified(channelIds[0], hubId);
    }
  }

  return connections;
};

export const updateConnection = async (where: whereUniuqeInput, data: dataInput) => {
  const conn = await db.connection.findFirst({ where });
  if (!conn) return null;

  // Update in database
  const connection = await db.connection.update({ where, data });

  // Invalidate cache for this connection and all channels in the hub
  if (connection.channelId) {
    await MessageProcessor.onConnectionModified(connection.channelId, connection.hubId);
  }

  // If channelId was changed, also invalidate the old channelId
  if (data.channelId && typeof data.channelId === 'string' && data.channelId !== conn.channelId) {
    await MessageProcessor.onConnectionModified(conn.channelId, conn.hubId);
  }

  return connection;
};

export const updateConnections = async (where: whereInput, data: dataInput) => {
  // First get all affected connections to invalidate their caches
  const connections = await db.connection.findMany({ where });

  // Group connections by hubId for efficient cache invalidation
  const connectionsByHub = new Map<string, string[]>();

  for (const conn of connections) {
    if (!conn.channelId) continue;

    if (!connectionsByHub.has(conn.hubId)) {
      connectionsByHub.set(conn.hubId, []);
    }
    connectionsByHub.get(conn.hubId)?.push(conn.channelId);
  }

  // Update in database
  const updated = await db.connection.updateMany({ where, data });

  // Invalidate cache for each hub and its connections
  for (const [hubId, channelIds] of connectionsByHub.entries()) {
    // Invalidate the first channel with the hubId to trigger hub-wide invalidation
    if (channelIds.length > 0) {
      await MessageProcessor.onConnectionModified(channelIds[0], hubId);
    }
  }

  return updated;
};

export const sendInviteCreatedResponse = async (
  interaction: RepliableInteraction | Context | ComponentContext | MessageComponentInteraction,
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
    | Context
    | ComponentContext
    | RepliableInteraction<'cached'>
    | MessageComponentInteraction<'cached'>,
  connection: Connection,
  locale: supportedLocaleCodes,
): Promise<string | undefined> => {
  if (!interaction.guild) return undefined;

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
