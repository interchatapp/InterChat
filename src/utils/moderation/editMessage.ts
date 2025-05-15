import { WebhookClient } from 'discord.js';
import { getBroadcasts } from '#src/utils/network/messageUtils.js';
import { getHubConnections } from '#utils/ConnectedListUtils.js';
import { RedisKeys } from '#utils/Constants.js';
import getRedis from '#utils/Redis.js';
import db from '#utils/Db.js';
import Logger from '#src/utils/Logger.js';

/**
 * Sets a lock to prevent concurrent edits of the same message
 * @param messageId The ID of the message being edited
 */
export const setEditLock = async (messageId: string) => {
  const redis = getRedis();
  const key = `${RedisKeys.msgEditInProgress}:${messageId}` as const;
  const alreadyLocked = await redis.get(key);
  if (alreadyLocked !== 't') await redis.set(key, 't', 'EX', 300); // 5 mins
};

/**
 * Checks if a message is currently being edited
 * @param messageId The ID of the message to check
 * @returns True if the message is being edited, false otherwise
 */
export const isEditInProgress = async (messageId: string) => {
  const redis = getRedis();
  const key = `${RedisKeys.msgEditInProgress}:${messageId}` as const;
  const locked = await redis.get(key);
  return locked === 't';
};

/**
 * Releases the edit lock for a message
 * @param messageId The ID of the message to release the lock for
 */
export const releaseEditLock = async (messageId: string) => {
  const redis = getRedis();
  const key = `${RedisKeys.msgEditInProgress}:${messageId}` as const;
  await redis.del(key);
};

/**
 * Edits a message across all channels in a hub
 * @param hubId The ID of the hub containing the message
 * @param originalMsgId The ID of the original message to edit
 * @param newContent The new content for the message
 * @param imageUrl Optional image URL to preserve in the edited message
 * @returns Object containing the number of messages edited and the total number of messages
 */
export const editMessageInHub = async (
  hubId: string,
  originalMsgId: string,
  newContent: string,
  imageUrl: string | null = null,
) => {
  try {
    // Get all broadcasts of this message
    const msgsToEdit = await getBroadcasts(originalMsgId);

    if (!msgsToEdit?.length) return { editedCount: 0, totalCount: 0 };

    // Set edit lock to prevent concurrent edits
    await setEditLock(originalMsgId);

    let editedCount = 0;
    const hubConnections = await getHubConnections(hubId);
    const hubConnectionsMap = new Map(hubConnections?.map((c) => [c.channelId, c]));

    // Update the original message in the database
    await db.message.update({
      where: { id: originalMsgId },
      data: { content: newContent },
    });

    // Edit each broadcast message
    for await (const dbMsg of msgsToEdit) {
      const connection = hubConnectionsMap.get(dbMsg.channelId);
      if (!connection) continue;

      try {
        const webhook = new WebhookClient({ url: connection.webhookURL });
        const threadId = connection.parentId ? connection.channelId : undefined;

        // Edit the message via webhook
        await webhook.editMessage(dbMsg.id, {
          content: newContent,
          threadId,
          // Preserve the image if it exists
          ...(imageUrl && { files: [imageUrl] }),
        }).catch((error) => {
          Logger.error(`Failed to edit message ${dbMsg.id} in channel ${dbMsg.channelId}:`, error);
          return null;
        });

        editedCount++;
      }
      catch (error) {
        Logger.error(`Error editing message ${dbMsg.id} in channel ${dbMsg.channelId}:`, error);
      }
    }

    // Release the edit lock
    await releaseEditLock(originalMsgId);

    return { editedCount, totalCount: msgsToEdit.length };
  }
  catch (error) {
    // Make sure to release the lock even if an error occurs
    await releaseEditLock(originalMsgId);
    Logger.error(`Error in editMessageInHub for message ${originalMsgId}:`, error);
    return { editedCount: 0, totalCount: 0 };
  }
};
