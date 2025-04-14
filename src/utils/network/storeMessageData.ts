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

import type { APIMessage, Message } from 'discord.js';
import {
  type Broadcast,
  type OriginalMessage,
  addBroadcasts,
  storeMessage,
  storeMessageTimestamp,
} from '#src/utils/network/messageUtils.js';
import { updateConnections } from '#utils/ConnectedListUtils.js';
import type { ConnectionMode } from '#utils/Constants.js';
import Logger from '#src/utils/Logger.js';

interface ErrorResult {
  webhookURL: string;
  channelId: string;
  error: string;
}

interface SendResult {
  messageRes: APIMessage;
  channelId: string;
  mode: ConnectionMode;
  webhookURL: string;
}

export const webhookErrorMessages = [
  'Unknown Webhook',
  'Unknown Channel',
  'Missing Permissions',
  'Invalid Webhook Token',
  'The provided webhook URL is not valid.',
];

export type NetworkWebhookSendResult = ErrorResult | SendResult;

/**
 * Stores message data in the database and updates the Connection based on the webhook status.
 * @param channelAndMessageIds The result of sending the message to multiple channels.
 * @param hubId The ID of the hub to connect the message data to.
 */
export default async (
  message: Message,
  broadcastResults: NetworkWebhookSendResult[],
  hubId: string,
  dbReference?: OriginalMessage,
  attachmentUrl?: string,
) => {
  if (!message.inGuild()) return;

  await storeMessage(message.id, {
    hubId,
    content: message.content,
    imageUrl: attachmentUrl || null,
    messageId: message.id,
    authorId: message.author.id,
    guildId: message.guildId,
    channelId: message.channelId,
    referredMessageId: dbReference?.messageId,
    timestamp: message.createdTimestamp,
  });

  const invalidWebhookURLs: string[] = [];
  const validBroadcasts: Broadcast[] = [];

  // loop through all results and extract message data and invalid webhook urls
  for (const res of broadcastResults) {
    if ('error' in res) {
      if (webhookErrorMessages.some((e) => res.error.includes(e))) {
        invalidWebhookURLs.push(res.webhookURL);
        Logger.debug(`Failed to send a message with error: ${res.error}. Disconnecting connection.`);
      }
      continue;
    }
    validBroadcasts.push({
      mode: res.mode,
      messageId: res.messageRes.id,
      channelId: res.messageRes.channel_id,
      originalMsgId: message.id,
    });
  }

  if (validBroadcasts.length > 0) await addBroadcasts(hubId, message.id, ...validBroadcasts);
  await storeMessageTimestamp(message);

  // disconnect network if, webhook does not exist/bot cannot access webhook
  if (invalidWebhookURLs.length > 0) {
    Logger.debug(`Disconnecting invalid connections: ${invalidWebhookURLs.join(', ')}`);
    await updateConnections({ webhookURL: { in: invalidWebhookURLs } }, { connected: false });
  }
};
