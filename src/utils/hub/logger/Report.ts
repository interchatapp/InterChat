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

import { modPanelButton } from '#src/interactions/ShowModPanel.js';
import { findOriginalMessage, getBroadcast } from '#src/utils/network/messageUtils.js';
import { markResolvedButton } from '#src/interactions/MarkResolvedButton.js';
import { HubService } from '#src/services/HubService.js';
import { RedisKeys } from '#src/utils/Constants.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import db from '#utils/Db.js';
import getRedis from '#utils/Redis.js';
import { resolveEval } from '#utils/Utils.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  EmbedBuilder,
  type GuildTextBasedChannel,
  type User,
  codeBlock,
  messageLink,
} from 'discord.js';
import { sendLog } from './Default.js';

export type ReportEvidenceOpts = {
  // the message content
  content?: string;
  messageId?: string;
  attachmentUrl?: string;
};

export type LogReportOpts = {
  userId: string;
  serverId: string;
  reason: string;
  reportedBy: User;
  evidence?: ReportEvidenceOpts;
};

/**
 * Retrieves the jump link for a specific message in the reports channel of a hub.
 * @param hubId - The ID of the hub.
 * @param messageId - The ID of the message. (optional)
 * @param reportsChannelId - The ID of the reports channel.
 * @returns The jump link for the specified message, or undefined if the message is not found.
 */
const genJumpLink = async (
  hubId: string,
  client: Client,
  messageId: string | undefined,
  reportsChannelId: string,
) => {
  if (!messageId) return null;

  const originalMsg = await findOriginalMessage(messageId);
  if (!originalMsg) return null;

  // fetch the reports server ID from the log channel's ID
  const reportsServerId = resolveEval(
    await client.cluster.broadcastEval(
      async (cl, channelId) => {
        const channel = (await cl.channels
          .fetch(channelId)
          .catch(() => null)) as GuildTextBasedChannel | null;
        return channel?.guild.id;
      },
      { context: reportsChannelId },
    ),
  );

  const networkChannel = await db.connection.findFirst({
    where: { serverId: reportsServerId, hubId },
  });

  if (!networkChannel) return null;

  const reportsServerMsg = await getBroadcast(originalMsg.messageId, originalMsg.hubId, {
    channelId: networkChannel.channelId,
  });
  if (!reportsServerMsg) return null;

  return messageLink(networkChannel.channelId, reportsServerMsg.messageId, networkChannel.serverId);
};

/**
 * Logs a report with the specified details.
 * @param userId - The ID of the user being reported.
 * @param serverId - The ID of the server being reported.
 * @param reason - The reason for the report.
 * @param reportedBy - The user who reported the incident.
 * @param evidence - Optional evidence for the report.
 */
export const sendHubReport = async (
  hubId: string,
  client: Client,
  { userId, serverId, reason, reportedBy, evidence }: LogReportOpts,
) => {
  const hub = await new HubService().fetchHub(hubId);
  const logConfig = await hub?.fetchLogConfig();

  if (!logConfig?.config.reports?.channelId || !evidence?.messageId) return;

  const { channelId: reportsChannelId, roleId: reportsRoleId } = logConfig.config.reports;
  const user = await client.users.fetch(userId).catch(() => null);
  const server = await client.fetchGuild(serverId);
  const jumpLink = await genJumpLink(hubId, client, evidence?.messageId, reportsChannelId);

  const dotRedEmoji = getEmoji('dotRed', client);

  const embed = new EmbedBuilder()
    .setTitle('New Report')
    .setColor('Red')
    .setImage(evidence?.attachmentUrl ?? null)
    .setDescription(
      stripIndents`
        ${getEmoji('info_icon', client)} **Message Content:**
        ${codeBlock(evidence?.content?.replaceAll('`', '\\`') || 'No content provided.')}
        ${dotRedEmoji} **Reported User:** @${user?.username} (${userId})
        ${dotRedEmoji} **Reported Server:** ${server?.name} (${serverId})
        ${dotRedEmoji} **Reported MessageID:** ${evidence.messageId}
      `,
    )
    .addFields([{ name: 'Reason', value: reason, inline: true }])
    .setFooter({
      text: `Reported by: ${reportedBy.username}`,
      iconURL: reportedBy.displayAvatarURL(),
    });

  const button = modPanelButton(evidence.messageId, getEmoji('hammer_icon', client)).setLabel(
    'Take Action',
  );
  const resolveButton = markResolvedButton(hubId); // anyone can use this button, it's on mods to set proper permissions for reports channel
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button, resolveButton);

  if (jumpLink) {
    row.addComponents(
      new ButtonBuilder().setURL(jumpLink).setLabel('Jump To Message').setStyle(ButtonStyle.Link),
    );
  }

  const sentMessage = await sendLog(client.cluster, reportsChannelId, embed, {
    roleMentionIds: reportsRoleId ? [reportsRoleId] : undefined,
    components: [row.toJSON()],
  });

  // Store the reporter's ID in Redis with a 48-hour expiration
  if (sentMessage?.id) {
    const redis = getRedis();
    const key = `${RedisKeys.ReportReporter}:${sentMessage.id}`;
    await redis.set(key, reportedBy.id, 'EX', 48 * 60 * 60); // 48 hours in seconds
  }
};
