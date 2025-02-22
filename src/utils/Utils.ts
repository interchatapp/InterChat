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

import UserDbService from '#src/services/UserDbService.js';
import db from '#src/utils/Db.js';
import {
  type ErrorHandlerOptions,
  createErrorHint,
  sendErrorResponse,
} from '#src/utils/ErrorUtils.js';
import { type supportedLocaleCodes } from '#src/utils/Locale.js';
import type { RemoveMethods, ThreadParentChannel } from '#types/CustomClientProps.d.ts';
import Constants from '#utils/Constants.js';
import { ErrorEmbed } from '#utils/EmbedUtils.js';
import Logger from '#utils/Logger.js';
import type { UserData } from '@prisma/client';
import { captureException } from '@sentry/node';
import {
  type CommandInteraction,
  type ContextMenuCommandInteraction,
  EmbedBuilder,
  type Guild,
  type GuildTextBasedChannel,
  Message,
  type MessageComponentInteraction,
  type RepliableInteraction,
  type Snowflake,
  type VoiceBasedChannel,
} from 'discord.js';
import startCase from 'lodash/startCase.js';
import toLower from 'lodash/toLower.js';

export const resolveEval = <T>(value: T[]) =>
  value?.find((res) => Boolean(res)) as RemoveMethods<T> | undefined;

export const msToReadable = (milliseconds: number, short = true): string => {
  if (milliseconds < 0) return 'Invalid input';
  if (milliseconds === 0) return short ? '0s' : '0 seconds';

  const timeUnits = [
    { div: 31536000000, short: 'y', long: 'year' },
    { div: 2629746000, short: 'm', long: 'month' },
    { div: 86400000, short: 'd', long: 'day' },
    { div: 3600000, short: 'h', long: 'hour' },
    { div: 60000, short: 'm', long: 'minute' },
    { div: 1000, short: 's', long: 'second' },
  ];

  let remainingMs = milliseconds;
  const parts: string[] = [];

  for (const unit of timeUnits) {
    const value = Math.floor(remainingMs / unit.div);
    if (value > 0) {
      // eslint-disable-next-line no-nested-ternary
      const suffix = short ? unit.short : value === 1 ? ` ${unit.long}` : ` ${unit.long}s`;

      parts.push(`${value}${suffix}`);
      remainingMs %= unit.div;
    }
  }

  // Limit to two most significant parts for readability
  return parts.join(' ');
};

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const yesOrNoEmoji = (option: unknown, yesEmoji: string, noEmoji: string) =>
  option ? yesEmoji : noEmoji;

export const findExistingWebhook = async (channel: ThreadParentChannel | VoiceBasedChannel) => {
  const webhooks = await channel?.fetchWebhooks().catch(() => null);
  return webhooks?.find((w) => w.owner?.id === channel.client.user?.id);
};

export const createWebhook = async (
  channel: ThreadParentChannel | VoiceBasedChannel,
  avatar: string,
  name: string,
) =>
  await channel
    ?.createWebhook({
      name,
      avatar,
    })
    .catch(() => undefined);

export const getOrCreateWebhook = async (
  channel: GuildTextBasedChannel,
  avatar = Constants.Links.EasterAvatar,
  name = 'InterChat Network',
) => {
  const channelOrParent = channel.isThread() ? channel.parent : channel;
  if (!channelOrParent) return null;

  const existingWebhook = await findExistingWebhook(channelOrParent);
  return existingWebhook || (await createWebhook(channelOrParent, avatar, name));
};

export const getCredits = () => [
  ...Constants.DeveloperIds,
  ...Constants.StaffIds,
  ...Constants.SupporterIds,
];

export const checkIfStaff = (userId: string, onlyCheckForDev = false) => {
  const staffMembers = [...Constants.DeveloperIds, ...(onlyCheckForDev ? [] : Constants.StaffIds)];
  return staffMembers.includes(userId);
};

export const replaceLinks = (string: string, replaceText = '`[LINK HIDDEN]`') =>
  string.replaceAll(Constants.Regex.Links, replaceText);

export const toTitleCase = (str: string) => startCase(toLower(str));

export const getReplyMethod = (
  interaction: RepliableInteraction | CommandInteraction | MessageComponentInteraction,
) => (interaction.replied || interaction.deferred ? 'followUp' : 'reply');

/**
    Invoke this method to handle errors that occur during command execution.
    It will send an error message to the user and log the error to the system.
  */
export const sendErrorEmbed = async (
  repliable: RepliableInteraction | Message | ContextMenuCommandInteraction,
  errorCode: string,
  comment?: string,
) => {
  const errorEmbed = new ErrorEmbed(repliable.client, { errorCode });
  if (comment) errorEmbed.setDescription(comment);

  if (repliable instanceof Message) {
    return await repliable.reply({
      embeds: [errorEmbed],
      allowedMentions: { repliedUser: false },
    });
  }

  const method = getReplyMethod(repliable);
  return await repliable[method]({
    embeds: [errorEmbed],
    flags: ['Ephemeral'],
  });
};

export function handleError(error: unknown, options: ErrorHandlerOptions = {}): void {
  const { repliable, comment } = options;

  // Enhance error message if possible
  if (error instanceof Error && comment) {
    error.message = `${comment}: ${error.message}`;
  }

  // Log the error
  Logger.error(error);

  // Create hint with additional context
  const hint = createErrorHint(repliable, comment);

  // Capture in Sentry
  const errorCode = captureException(error, hint);

  // Send error response if possible
  if (repliable) {
    sendErrorResponse(repliable, errorCode, comment);
  }
}

export const isDev = (userId: Snowflake) => Constants.DeveloperIds.includes(userId);

export const escapeRegexChars = (input: string, type: 'simple' | 'full' = 'simple'): string =>
  input.replace(
    type === 'simple' ? Constants.Regex.SimpleRegexEscape : Constants.Regex.RegexChars,
    '\\$&',
  );

export const parseEmoji = (emoji: string) => {
  const match = emoji.match(Constants.Regex.Emoji);
  if (!match) return null;

  const [, animated, name, id] = match;
  return { animated: Boolean(animated), name, id };
};

export const getEmojiId = (emoji: string | undefined) => {
  const res = parseEmoji(emoji || '');
  return res?.id ?? emoji;
};

export const getOrdinalSuffix = (num: number) => {
  const j = num % 10;
  const k = num % 100;

  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
};

export const containsInviteLinks = (str: string) => {
  const inviteLinks = ['discord.gg', 'discord.com/invite', 'dsc.gg'];
  return inviteLinks.some((link) => str.includes(link));
};

export const getTagOrUsername = (username: string, discrim: string) =>
  discrim !== '0' ? `${username}#${discrim}` : username;

export const isHumanMessage = (message: Message) =>
  !message.author.bot && !message.system && !message.webhookId;

export const trimAndCensorBannedWebhookWords = (content: string) =>
  content.slice(0, 35).replace(Constants.Regex.BannedWebhookWords, '[censored]');

export const fetchUserData = async (userId: Snowflake) => {
  const user = await new UserDbService().getUser(userId);
  return user;
};

export const fetchUserLocale = async (user: Snowflake | UserData) => {
  const userData = typeof user === 'string' ? await fetchUserData(user) : user;
  return (userData?.locale ?? 'en') as supportedLocaleCodes;
};

export const extractChannelId = (input: string | undefined) => {
  const match = input?.match(Constants.Regex.ChannelId);
  return match?.[1] || match?.[2] || null;
};

export const extractUserId = (input: string | undefined) => {
  const match = input?.match(Constants.Regex.UserId);
  return match?.[1] || match?.[2] || null;
};

export const extractRoleId = (input: string | undefined) => {
  const match = input?.match(Constants.Regex.RoleId);
  return match?.[1] || match?.[2] || null;
};

export const extractMessageId = (input: string) =>
  input.match(Constants.Regex.MessageId)?.[1] ?? null;

interface InviteCreationResult {
  success: boolean;
  inviteUrl?: string;
}

export const createServerInvite = async (
  channelId: string,
  guild: Guild,
  username: string,
): Promise<InviteCreationResult> => {
  const invite = await guild.invites
    .create(channelId, {
      maxAge: 0,
      reason: `InterChat Hub connection invite. Initiated by ${username}.`,
    })
    .catch(() => null);

  return {
    success: Boolean(invite),
    inviteUrl: invite?.url,
  };
};

export const getLatestDevAlert = async () =>
  await db.announcement.findFirst({ orderBy: { createdAt: 'desc' } });

export const hasUnreadDevAlert = async (userData: UserData) => {
  const latestDevAnnouncement = await getLatestDevAlert();
  return Boolean(
    userData?.inboxLastReadDate &&
      latestDevAnnouncement &&
      latestDevAnnouncement.createdAt > userData.inboxLastReadDate,
  );
};

export const createUnreadDevAlertEmbed = (emoji: string) =>
  new EmbedBuilder()
    .setTitle(`${emoji} You have a new message from the developers!`)
    .setColor(Constants.Colors.invisible)
    .setDescription(
      'Use `/inbox` or `c!inbox` to read the latest announcement and dismiss this message.',
    );
