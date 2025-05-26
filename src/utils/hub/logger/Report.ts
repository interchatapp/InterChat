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

import { Message as MessageDB } from '#src/generated/prisma/client/index.js';
import { modPanelButton } from '#src/interactions/ShowModPanel.js';
import { HubService } from '#src/services/HubService.js';
import type { RemoveMethods } from '#src/types/Utils.d.ts';
import Constants from '#src/utils/Constants.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Logger from '#src/utils/Logger.js';
import { findOriginalMessage, getBroadcast } from '#src/utils/network/messageUtils.js';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { resolveEval } from '#utils/Utils.js';
import { stripIndents } from 'common-tags';
import {
  ButtonBuilder,
  ButtonStyle,
  type Client,
  ContainerBuilder,
  type Guild,
  type GuildTextBasedChannel,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type User,
  codeBlock,
  messageLink,
} from 'discord.js';
import { sendLog } from './Default.js';

export type LogReportOpts = {
  userId: string;
  serverId: string;
  reason: string;
  reportedBy: User;
  messageId?: string;
};

type ReplyContextData = {
  id: string;
  isReply: boolean;
  originalContent?: string;
  originalAuthor?: string;
} | null;

/**
 * Generate a jump link to the reported message in the reports server
 */
const genJumpLink = async (
  hubId: string,
  client: Client,
  originalMsg: MessageDB,
  reportsChannelId?: string,
): Promise<string | null> => {
  if (!reportsChannelId) return null;

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

  const reportsServerMsg = await getBroadcast(originalMsg.id, {
    channelId: networkChannel.channelId,
  });
  if (!reportsServerMsg) return null;

  return messageLink(networkChannel.channelId, reportsServerMsg.messageId, networkChannel.serverId);
};

/**
 * Create a report record in the database
 */
const createReportRecord = async (
  hubId: string,
  { userId, serverId, reason, reportedBy, messageId }: LogReportOpts,
): Promise<string> => {
  const report = await db.report.create({
    data: {
      hubId,
      reporterId: reportedBy.id,
      reportedUserId: userId,
      reportedServerId: serverId,
      messageId,
      reason,
    },
  });

  return report.id;
};

/**
 * Get reply context for a message if it's a reply
 */
const getReplyContext = async (
  messageId?: string,
): Promise<{
  id: string;
  isReply: boolean;
  originalContent?: string;
  originalAuthor?: string;
} | null> => {
  if (!messageId) return null;

  const message = await db.message.findUnique({
    where: { id: messageId },
    include: {
      referredTo: true,
    },
  });

  if (!message) return null;

  if (!message?.referredTo) {
    return { id: message.id, isReply: false };
  }

  return {
    id: message.id,
    isReply: true,
    originalContent: message.referredTo.content,
    originalAuthor: message.referredTo.authorId,
  };
};

/**
 * Prepare all data needed for the report
 */
const prepareReportData = async (hubId: string, client: Client, opts: LogReportOpts) => {
  const hub = await new HubService().fetchHub(hubId);
  const logConfig = await hub?.fetchLogConfig();

  if (!logConfig?.config.reportsChannelId || !opts?.messageId) {
    return null;
  }

  const reportsChannelId = logConfig.config.reportsChannelId;
  const reportsRoleId = logConfig.config.reportsRoleId;

  const originalMsg = await findOriginalMessage(opts.messageId);
  if (!originalMsg) return null;

  const user = await client.users.fetch(opts.userId).catch(() => null);
  const server = await client.fetchGuild(opts.serverId);
  const jumpLink = await genJumpLink(hubId, client, originalMsg, reportsChannelId);
  const reportId = await createReportRecord(hubId, opts);
  const replyContext = await getReplyContext(opts?.messageId);

  return {
    reportsChannelId,
    reportsRoleId,
    user,
    server,
    jumpLink,
    reportId,
    replyContext,
    content: originalMsg.content,
  };
};

/**
 * Build the header section with report info and action button
 */
const buildHeaderSection = (
  client: Client,
  reportId: string,
  opts: LogReportOpts,
  user: User | null,
  server: RemoveMethods<Guild> | undefined,
) => {
  // Ensure we have a messageId before proceeding
  if (!opts.messageId) {
    throw new Error('Message ID is required for building header section');
  }

  return new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        stripIndents`
          ## ${getEmoji('alert_icon', client)} New Report • ID: \`${reportId}\`

          **Reported User:** @${user?.username} (\`${opts.userId}\`)
          **Reported Server:** ${server?.name} (\`${opts.serverId}\`)
          **Reported by:** ${opts.reportedBy.username}
          **Reason:** ${opts.reason}
        `,
      ),
    )
    .setButtonAccessory(
      modPanelButton(opts.messageId, getEmoji('hammer_icon', client) || '🔨').setLabel(
        'Take Action',
      ),
    )
    .setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(user?.displayAvatarURL() || Constants.Links.EasterAvatar)
        .setDescription('User avatar'),
    );
};

/**
 * Build the reply context section if applicable
 */
const buildReplyContextSection = (client: Client, replyContext: ReplyContextData) => {
  if (!replyContext?.isReply || !replyContext.originalContent) {
    return null;
  }

  return new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        stripIndents`
          ### ${getEmoji('reply', client)} Reply Context
          **Original message:** ${codeBlock(replyContext.originalContent.slice(0, 200))}
        `,
      ),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(
          new CustomID().setIdentifier('reply_context_view').setArgs(replyContext.id).toString(),
        )
        .setStyle(ButtonStyle.Secondary)
        .setLabel('View Context')
        .setEmoji(getEmoji('search', client)),
    );
};

/**
 * Build the content section with message details
 */
const buildContentSection = (
  client: Client,
  opts: LogReportOpts & { content: string },
  jumpLink: string | null,
) =>
  new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        stripIndents`
          ### ${getEmoji('info', client)} Reported Message
          ${codeBlock(opts.content?.replaceAll('`', '\\`') || 'No content provided.')}
          **Message ID:** \`${opts.messageId}\`
        `,
      ),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setURL(jumpLink ?? 'https://discord.com')
        .setDisabled(!jumpLink)
        .setLabel('Jump To Message')
        .setStyle(ButtonStyle.Link)
        .setEmoji(getEmoji('link', client) || '🔗'),
    );

/**
 * Build media gallery if attachment is present
 */
const buildMediaGallery = (attachmentUrl?: string) => {
  if (!attachmentUrl) return null;

  const mediaGallery = new MediaGalleryBuilder();
  const mediaItem = new MediaGalleryItemBuilder()
    .setURL(attachmentUrl)
    .setDescription('Reported message attachment');

  mediaGallery.addItems(mediaItem);
  return mediaGallery;
};

/**
 * Build action buttons for the report
 */
const buildActionButtons = (client: Client, reportId: string) => {
  const resolveButton = new ButtonBuilder()
    .setCustomId(
      new CustomID().setIdentifier('reportAction', 'resolve').setArgs(reportId).toString(),
    )
    .setStyle(ButtonStyle.Success)
    .setLabel('Mark Resolved')
    .setEmoji(getEmoji('tick_icon', client) || '✅');

  const ignoreButton = new ButtonBuilder()
    .setCustomId(
      new CustomID().setIdentifier('reportAction', 'ignore').setArgs(reportId).toString(),
    )
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Ignore Report')
    .setEmoji(getEmoji('x_icon', client) || '❌');

  return { resolveButton, ignoreButton };
};

/**
 * Enhanced report logging with Components v2 UI
 */
export const sendHubReport = async (
  hubId: string,
  client: Client,
  opts: LogReportOpts,
): Promise<void> => {
  const reportData = await prepareReportData(hubId, client, opts);
  if (!reportData) return;

  const { reportsChannelId, reportsRoleId, user, server, jumpLink, reportId, replyContext } =
    reportData;

  const container = new ContainerBuilder();

  // Add header section
  const headerSection = buildHeaderSection(client, reportId, opts, user, server);
  container.addSectionComponents(headerSection);
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  // Add reply context section if applicable
  const replySection = buildReplyContextSection(client, replyContext);
  if (replySection) {
    container.addSectionComponents(replySection);
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  }

  // Add content section
  const contentSection = buildContentSection(
    client,
    { ...opts, content: reportData.content },
    jumpLink,
  );
  container.addSectionComponents(contentSection);

  // FIXME: Add media gallery if present
  const attachmentUrl =
    reportData.content?.match(Constants.Regex.StaticImageUrl)?.[0] ??
    reportData.content.match(Constants.Regex.TenorLinks)?.[0] ??
    undefined;

  const mediaGallery = buildMediaGallery(attachmentUrl);
  if (mediaGallery) {
    container.addMediaGalleryComponents(mediaGallery);
  }

  // Add action buttons
  const { resolveButton, ignoreButton } = buildActionButtons(client, reportId);
  container.addActionRowComponents((row) => row.addComponents(resolveButton, ignoreButton));

  // Send the log with Components v2
  await sendLog(client.cluster, reportsChannelId, null, {
    roleMentionIds: reportsRoleId ? [reportsRoleId] : undefined,
    components: [container.toJSON()],
    flags: [MessageFlags.IsComponentsV2],
  });

  // Send immediate DM notification to reporter with report ID
  await sendReporterConfirmation(client, reportId, opts.reportedBy);
};

/**
 * Send immediate DM confirmation to reporter with their report ID
 */
const sendReporterConfirmation = async (
  _client: Client,
  reportId: string,
  reporter: User,
): Promise<void> => {
  try {
    const embed = {
      title: '📋 Report Submitted Successfully',
      description: stripIndents`
        Thank you for submitting your report. Our moderation team will review it shortly.

        **Your Report ID:** \`${reportId}\`
        **Status:** Pending Review

        You will receive a notification when action is taken on your report.
        Please keep this ID for your records.
      `,
      color: 0x5865f2,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'InterChat Moderation System',
      },
    };

    await reporter.send({ embeds: [embed] }).catch(() => null);
  }
  catch (e) {
    Logger.error('Failed to send reporter confirmation', e);
  }
};
