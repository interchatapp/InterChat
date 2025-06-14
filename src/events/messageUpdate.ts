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

import BaseEventListener from '#src/core/BaseEventListener.js';
import { HubService } from '#src/services/HubService.js';
import db from '#src/utils/Db.js';
import { logMsgEdit } from '#src/utils/hub/logger/MsgLogs.js';
import { editMessageInHub, isEditInProgress } from '#src/utils/moderation/editMessage.js';
import { getOriginalMessage } from '#src/utils/network/messageUtils.js';
import { stripIndents } from 'common-tags';
import { Message, PartialMessage } from 'discord.js';
import Logger from '#src/utils/Logger.js';

export default class MessageUpdate extends BaseEventListener<'messageUpdate'> {
  readonly name = 'messageUpdate';

  private readonly hubService = new HubService();

  public async execute(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) {
    // Skip if not in a guild or if the content hasn't changed
    if (!newMessage.inGuild() || oldMessage.content === newMessage.content) return;

    // Skip if the message is from a webhook (broadcast message)
    if (newMessage.webhookId) return;

    // Skip if the message is a system message
    if (newMessage.system) return;

    // Find the connection for this channel
    const connection = await db.connection.findFirst({
      where: { channelId: newMessage.channelId },
      select: { hubId: true },
    });
    if (!connection) return;

    // Get the hub
    const hub = await this.hubService.fetchHub(connection.hubId);
    if (!hub) return;

    // Check if this is an original message in our database
    const originalMsg = await getOriginalMessage(newMessage.id);
    if (!originalMsg) return;

    // Check if the message is already being edited
    if (await isEditInProgress(originalMsg.id)) {
      Logger.debug(`Message ${originalMsg.id} is already being edited, skipping direct edit`);
      return;
    }

    // Notify the user that their message will be edited across all servers
    newMessage.channel
      .send({
        content: stripIndents`
        ${this.getEmoji('info_icon')} <@${newMessage.author.id}> you edited a message from this channel, which is connected to a hub. It will be edited in other linked servers as well.
        -# You can also manually edit the message from the hub by using the </editmsg:0> command.
        `,
        allowedMentions: { users: [newMessage.author.id] },
      })
      .then((msg) => setTimeout(() => msg.delete(), 10_000))
      .catch(() => null);

    // Edit the message across all hub connections
    const { editedCount, totalCount } = await editMessageInHub(
      hub.id,
      originalMsg.id,
      newMessage.content || '',
      originalMsg.imageUrl,
    );

    Logger.info(`Edited ${editedCount}/${totalCount} messages for message ${originalMsg.id} in hub ${hub.id}`);

    // Log the edit to the hub's mod logs
    await logMsgEdit(newMessage.client, originalMsg, newMessage.content || '', await hub.fetchLogConfig(), {
      hubName: hub.data.name,
      modName: newMessage.author.username ?? 'Unknown',
    });
  }
}
