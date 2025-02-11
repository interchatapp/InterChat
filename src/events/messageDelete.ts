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
import { getConnectionHubId } from '#src/utils/ConnectedListUtils.js';
import { logMsgDelete } from '#src/utils/hub/logger/ModLogs.js';
import { fetchHub } from '#src/utils/hub/utils.js';
import { deleteMessageFromHub } from '#src/utils/moderation/deleteMessage.js';
import { getOriginalMessage } from '#src/utils/network/messageUtils.js';
import { stripIndents } from 'common-tags';
import { AuditLogEvent, Message, OmitPartialGroupDMChannel, PartialMessage } from 'discord.js';

export default class MessageDelete extends BaseEventListener<'messageDelete'> {
  readonly name = 'messageDelete';

  public async execute(message: OmitPartialGroupDMChannel<Message<boolean> | PartialMessage>) {
    if (!message.inGuild()) return;

    const fetchedLogs = await message.guild.fetchAuditLogs({
      type: AuditLogEvent.MessageDelete,
      limit: 10,
    });

    const deletedMessageLog = fetchedLogs.entries.find(
      (entry) =>
        entry.targetId === message.author.id &&
        entry.extra.channel.id === message.channelId &&
        entry.createdTimestamp > Date.now() - 5000,
    );

    const deletedBy = deletedMessageLog?.executor ?? message.author;

    const connectionHubId = await getConnectionHubId(message.channelId);
    if (!connectionHubId) return;

    const hub = await fetchHub({ id: connectionHubId });
    if (!hub) return;

    // strictly check if the message is the original, non-webhook message
    // because with broadcasts (webhook messages), there is no possible way of knowing who deleted the message through audit logs
    const originalMsg = await getOriginalMessage(message.id);
    if (!originalMsg) return;

    message.channel
      .send({
        content: stripIndents`
        ${this.getEmoji('info_icon')} ${deletedBy}, you deleted a message from this channel. As this channel is linked to a hub, it will be deleted from other linked servers as well.
        -# Hub moderators can still see the message in the mod logs. Whatever you say in a hub is your responsibility.
        `,
        allowedMentions: { users: [deletedBy.id] },
      })
      .then((msg) => setTimeout(() => msg.delete(), 10_000))
      .catch(() => null);

    await deleteMessageFromHub(hub.id, originalMsg.messageId);

    await logMsgDelete(message.client, originalMsg, await hub.fetchLogConfig(), {
      hubName: hub.data.name,
      modName: deletedBy.username,
    });
  }
}
