import { updateConnections } from '#main/utils/ConnectedList.js';
import Constants from '#main/utils/Constants.js';
import db from '#main/utils/Db.js';
import Logger from '#main/utils/Logger.js';
import cacheClient from '#main/utils/cache/cacheClient.js';
import { originalMessages } from '@prisma/client';
import { APIMessage, Message } from 'discord.js';

export interface NetworkWebhookSendResult {
  messageRes?: APIMessage;
  error?: string;
  webhookURL: string;
}

/**
 * Stores message data in the database and updates the connectedList based on the webhook status.
 * @param channelAndMessageIds The result of sending the message to multiple channels.
 * @param hubId The ID of the hub to connect the message data to.
 */
export default async (
  message: Message,
  channelAndMessageIds: NetworkWebhookSendResult[],
  hubId: string,
  dbReference?: originalMessages | null,
) => {
  const messageDataObj: { channelId: string; messageId: string; createdAt: Date }[] = [];
  const invalidWebhookURLs: string[] = [];
  const validErrors = ['Invalid Webhook Token', 'Unknown Webhook', 'Missing Permissions'];

  // loop through all results and extract message data and invalid webhook urls
  channelAndMessageIds.forEach(({ messageRes, error, webhookURL }) => {
    if (messageRes) {
      messageDataObj.push({
        channelId: messageRes.channel_id,
        messageId: messageRes.id,
        createdAt: new Date(messageRes.timestamp),
      });
    }
    else if (error && validErrors.some((e) => error.includes(e))) {
      Logger.info('%O', messageRes); // TODO Remove dis
      invalidWebhookURLs.push(webhookURL);
    }
  });

  if (hubId && messageDataObj.length > 0) {
    if (!message.inGuild()) return;

    // store message data in db
    await db.originalMessages.create({
      data: {
        messageId: message.id,
        authorId: message.author.id,
        serverId: message.guildId,
        messageReference: dbReference?.messageId,
        createdAt: message.createdAt,
        broadcastMsgs: { createMany: { data: messageDataObj } },
        hub: { connect: { id: hubId } },
        reactions: {},
      },
    });
  }

  // store message timestamps to push to db later
  await cacheClient.set(
    `${Constants.RedisKeys.msgTimestamp}:${message.channelId}`,
    JSON.stringify({
      channelId: message.channelId,
      timestamp: message.createdTimestamp,
    }),
  );

  // disconnect network if, webhook does not exist/bot cannot access webhook
  if (invalidWebhookURLs.length > 0) {
    await updateConnections({ webhookURL: { in: invalidWebhookURLs } }, { connected: false });
  }
};
