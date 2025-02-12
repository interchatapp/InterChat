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

import { type Snowflake, WebhookClient } from 'discord.js';
import {
  type Broadcast,
  deleteMessageCache,
  getBroadcasts,
} from '#src/utils/network/messageUtils.js';
import { getHubConnections } from '#utils/ConnectedListUtils.js';
import { RedisKeys } from '#utils/Constants.js';
import getRedis from '#utils/Redis.js';

export const setDeleteLock = async (messageId: string) => {
  const redis = getRedis();
  const key = `${RedisKeys.msgDeleteInProgress}:${messageId}` as const;
  const alreadyLocked = await redis.get(key);
  if (alreadyLocked !== 't') await redis.set(key, 't', 'EX', 900); // 15 mins
};

export const deleteMessageFromHub = async (
  hubId: string,
  originalMsgId: string,
  dbMessagesToDelete?: Broadcast[],
) => {
  let msgsToDelete = dbMessagesToDelete;
  if (!dbMessagesToDelete) {
    msgsToDelete = Object.values(await getBroadcasts(originalMsgId, hubId));
  }

  if (!msgsToDelete?.length) return { deletedCount: 0, totalCount: 0 };

  await setDeleteLock(originalMsgId);

  let deletedCount = 0;
  const hubConnections = await getHubConnections(hubId);
  const hubConnectionsMap = new Map(hubConnections?.map((c) => [c.channelId, c]));

  for await (const dbMsg of msgsToDelete) {
    const connection = hubConnectionsMap.get(dbMsg.channelId);
    if (!connection) continue;

    const webhook = new WebhookClient({ url: connection.webhookURL });
    const threadId = connection.parentId ? connection.channelId : undefined;
    await webhook.deleteMessage(dbMsg.messageId, threadId).catch(() => null);
    deletedCount++;
  }

  await getRedis().del(`${RedisKeys.msgDeleteInProgress}:${originalMsgId}`);
  deleteMessageCache(originalMsgId);
  return { deletedCount, totalCount: msgsToDelete.length };
};

export const isDeleteInProgress = async (originalMsgId: Snowflake) => {
  const res = await getRedis().get(`${RedisKeys.msgDeleteInProgress}:${originalMsgId}`);
  return res === 't';
};
