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

import type { User } from '#src/generated/prisma/client/client.js';
import type HubManager from '#src/managers/HubManager.js';
import type HubSettingsManager from '#src/managers/HubSettingsManager.js';
import MessageFormattingService from '#src/services/MessageFormattingService.js';
import { RequiredConnectionData } from '#src/services/MessageProcessor.js';
import { getVisibleBadges } from '#src/utils/BadgeUtils.js';
import Logger from '#src/utils/Logger.js';
import type { BroadcastOpts, ReferredMsgData } from '#src/utils/network/Types.d.ts';
import { generateJumpButton as getJumpButton } from '#utils/ComponentUtils.js';
import { ConnectionMode } from '#utils/Constants.js';
import { getAttachmentURL } from '#utils/ImageUtils.js';
import { trimAndCensorBannedWebhookWords } from '#utils/Utils.js';
import storeMessageData, {
  type NetworkWebhookSendResult,
} from '#utils/network/storeMessageData.js';
import { getReferredContent, getReferredMsgData } from '#utils/network/utils.js';
import type {
  APIMessage,
  Client,
  HexColorString,
  Message,
  WebhookMessageCreateOptions,
} from 'discord.js';

export class BroadcastService {
  async broadcastMessage(
    message: Message<true>,
    hub: HubManager,
    hubConnections: RequiredConnectionData[],
    connection: RequiredConnectionData,
    attachmentURL: string | undefined,
    userData: User | null,
  ) {
    const username = this.getUsername(hub.settings, message);
    const referredMessage = await this.fetchReferredMessage(message);
    const referredMsgData = await getReferredMsgData(referredMessage);

    // Sort connections by last active first
    const sortedHubConnections = hubConnections.sort(
      (a, b) => b.lastActive.getTime() - a.lastActive.getTime(),
    );

    Logger.debug(`Broadcasting message to ${sortedHubConnections.length} connections`);

    const allResults: NetworkWebhookSendResult[] = await Promise.all(
      sortedHubConnections.map((conn) =>
        this.sendToConnection(message, hub, conn, {
          attachmentURL,
          referredMsgData,
          embedColor: connection.embedColor as HexColorString,
          username,
          userData,
        }),
      ),
    );

    // store message data
    await storeMessageData(
      message,
      allResults,
      connection.hubId,
      referredMsgData.dbReferrence ?? undefined,
      attachmentURL,
    );
  }

  async resolveAttachmentURL(message: Message) {
    return (
      message.attachments.first()?.url ??
      (await getAttachmentURL(message.content)) ??
      message.stickers.first()?.url
    );
  }

  private async fetchReferredMessage(message: Message<true>): Promise<Message | null> {
    return message.reference ? await message.fetchReference().catch(() => null) : null;
  }

  private getUsername(settings: HubSettingsManager, message: Message<true>): string {
    return trimAndCensorBannedWebhookWords(
      settings.has('UseNicknames')
        ? (message.member?.displayName ?? message.author.displayName)
        : message.author.username,
    );
  }

  private async sendToConnection(
    message: Message<true>,
    hub: HubManager,
    connection: RequiredConnectionData,
    opts: BroadcastOpts & {
      username: string;
      userData: User | null;
      referredMsgData: ReferredMsgData;
    },
  ): Promise<NetworkWebhookSendResult> {
    try {
      const { webhookURL } = connection;

      if (webhookURL.length < 1) {
        return { error: 'No webhook URL', channelId: connection.channelId, webhookURL };
      }

      const messageFormat = await this.formatMessage(message, hub, connection, opts);
      const { error, message: messageRes } = await BroadcastService.sendMessage(
        webhookURL,
        messageFormat,
      );
      const mode = connection.compact ? ConnectionMode.Compact : ConnectionMode.Embed;

      if (error || !messageRes) {
        return { error: `${error}`, channelId: connection.channelId, webhookURL };
      }

      return { messageRes, channelId: connection.channelId, webhookURL, mode };
    }
    catch (e) {
      Logger.error(
        `Failed to send message to ${connection.channelId} in server ${connection.serverId}`,
        e,
      );
      return {
        error: e.message,
        channelId: connection.channelId,
        webhookURL: connection.webhookURL,
      };
    }
  }

  private async formatMessage(
    message: Message<true>,
    hub: HubManager,
    connection: RequiredConnectionData,
    opts: BroadcastOpts & {
      username: string;
      userData: User | null;
      referredMsgData: ReferredMsgData;
    },
  ) {
    const { dbReferrence, referredAuthor } = opts.referredMsgData;

    const author = {
      username: this.getUsername(hub.settings, message),
      avatarURL: message.author.displayAvatarURL(),
    };
    const jumpButton = this.getJumpButton(
      referredAuthor?.username ?? 'Unknown',
      connection,
      dbReferrence,
      message.client,
    );
    const servername = trimAndCensorBannedWebhookWords(message.guild.name);

    // Use the new utility function with hubId
    const badges = await getVisibleBadges(message.author.id, message.client, hub.id, opts.userData);
    const badgeText = badges ? `-# ${badges}\n` : '';

    const messageFormatter = new MessageFormattingService(connection);
    return messageFormatter.format(message, {
      ...opts,
      author,
      servername,
      jumpButton,
      hub: hub.data,
      badges: badgeText,
      referredContent: dbReferrence ? getReferredContent(dbReferrence) : undefined,
    });
  }

  private getJumpButton(
    username: string,
    { channelId, serverId }: RequiredConnectionData,
    dbReferrence: ReferredMsgData['dbReferrence'],
    client: Client,
  ) {
    const reply = dbReferrence?.broadcastMsgs.get(channelId) ?? dbReferrence;
    return reply?.id
      ? [
        getJumpButton(client, username, {
          channelId,
          serverId,
          messageId: reply.id,
        }),
      ]
      : undefined;
  }

  static async sendMessage(
    webhookUrl: string,
    data: WebhookMessageCreateOptions,
  ): Promise<{ message?: APIMessage; error?: string }> {
    const res = await fetch(`http://localhost:${process.env.PORT || 3000}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl, data }),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok || !json || json?.error) {
      return { error: json?.error ?? res.statusText ?? 'Unknown error' };
    }

    return { message: json.data };
  }
}
