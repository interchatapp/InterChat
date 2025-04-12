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

import BlacklistManager from '#src/managers/BlacklistManager.js';
import type HubManager from '#src/managers/HubManager.js';
import type HubSettingsManager from '#src/managers/HubSettingsManager.js';

import NSFWDetector from '#src/modules/NSFWDetection.js';
import UserDbService from '#src/services/UserDbService.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { sendBlacklistNotif } from '#src/utils/moderation/blacklistUtils.js';
import { checkBlockedWords } from '#src/utils/network/antiSwearChecks.js';
import Constants from '#utils/Constants.js';
import { t } from '#utils/Locale.js';
import { containsInviteLinks, fetchUserLocale, replaceLinks } from '#utils/Utils.js';
import type { User as DbUser } from '#src/generated/prisma/client/client.js';
import { stripIndents } from 'common-tags';
import { type Awaitable, EmbedBuilder, type Message } from 'discord.js';

export interface CheckResult {
  passed: boolean;
  reason?: string;
}

// Add new interface for call checks
interface CallCheckFunctionOpts {
  userData: DbUser;
  attachmentURL?: string | null;
}

interface HubCheckFunctionOpts extends CallCheckFunctionOpts {
  settings: HubSettingsManager;
  totalHubConnections: number;
  hub: HubManager;
  attachmentURL?: string | null;
}

type CheckFunction = (message: Message<true>, opts: HubCheckFunctionOpts) => Awaitable<CheckResult>;

type CallCheckFunction = (
  message: Message<true>,
  opts: CallCheckFunctionOpts,
) => Awaitable<CheckResult>;

// ordering is important - always check blacklists first (or they can bypass)
const checks: CheckFunction[] = [
  checkBanAndBlacklist,
  checkAntiSwear,
  checkHubLock,
  checkSpam,
  checkNewUser,
  checkMessageLength,
  checkInviteLinks,
  checkAttachments,
  checkNSFW,
  checkLinks,
  checkStickers,
];

// Add new array for call-specific checks
const callChecks: CallCheckFunction[] = [
  checkSpamForCalls,
  checkURLsForCalls,
  checkNSFW,
  checkGifsForCalls,
];

const replyToMsg = async (
  message: Message<true>,
  opts: { content?: string; embed?: EmbedBuilder },
) => {
  const embeds = opts.embed ? [opts.embed] : [];

  const reply = await message.reply({ content: opts.content, embeds }).catch(() => null);
  if (!reply) {
    await message.channel
      .send({
        content: `${message.author.toString()} ${opts.content ?? ''}`,
        embeds,
      })
      .catch(() => null);
  }
};

export const runChecks = async (
  message: Message<true>,
  hub: HubManager,
  opts: {
    userData: DbUser;
    settings: HubSettingsManager;
    totalHubConnections: number;
    attachmentURL?: string | null;
  },
): Promise<boolean> => {
  for (const check of checks) {
    const result = await check(message, { ...opts, hub });
    if (!result.passed) {
      if (result.reason) await replyToMsg(message, { content: result.reason });
      return false;
    }
  }

  return true;
};

export const runCallChecks = async (
  message: Message<true>,
  opts: {
    userData: DbUser;
    attachmentURL?: string | null;
  },
): Promise<boolean> => {
  for (const check of callChecks) {
    const result = await check(message, opts);
    if (!result.passed) {
      if (result.reason) await replyToMsg(message, { content: result.reason });
      return false;
    }
  }
  return true;
};

async function checkAntiSwear(
  message: Message<true>,
  { hub }: HubCheckFunctionOpts,
): Promise<CheckResult> {
  return await checkBlockedWords(message, await hub.fetchAntiSwearRules());
}

async function checkBanAndBlacklist(
  message: Message<true>,
  opts: HubCheckFunctionOpts,
): Promise<CheckResult> {
  const blacklistManager = new BlacklistManager('user', message.author.id);
  const blacklisted = await blacklistManager.fetchBlacklist(opts.hub.id);

  if (opts.userData?.banReason || blacklisted) {
    // If blacklisted, send notification
    if (blacklisted && !blacklisted.notified) {
      await sendBlacklistNotif('user', message.client, {
        target: message.author,
        hubId: opts.hub.id,
        expiresAt: blacklisted.expiresAt,
        reason: blacklisted.reason,
      }).catch(() => null);
    }
    return { passed: false };
  }

  return { passed: true };
}

async function checkHubLock(
  message: Message<true>,
  { hub }: HubCheckFunctionOpts,
): Promise<CheckResult> {
  if (hub.data.locked && !(await hub.isMod(message.author.id))) {
    return {
      passed: false,
      reason:
        'This hub\'s chat has been locked. Only moderators can send messages. Please check back later as this may be temporary.',
    };
  }
  return { passed: true };
}

const containsLinks = (message: Message, settings: HubSettingsManager) =>
  settings.has('HideLinks') &&
  !Constants.Regex.StaticImageUrl.test(message.content) &&
  Constants.Regex.Links.test(message.content);

function checkLinks(message: Message<true>, opts: HubCheckFunctionOpts): CheckResult {
  const { settings } = opts;
  if (containsLinks(message, settings)) {
    message.content = replaceLinks(message.content);
  }
  return { passed: true };
}

async function checkSpam(message: Message<true>, opts: HubCheckFunctionOpts): Promise<CheckResult> {
  const { settings, hub } = opts;
  const result = await message.client.antiSpamManager.handleMessage(message);

  if (settings.has('SpamFilter') && result) {
    if (result.messageCount >= 6) {
      const expiresAt = new Date(Date.now() + 60 * 5000);
      const reason = 'Auto-blacklisted for spamming.';
      const target = message.author;
      const mod = message.client.user;

      const blacklistManager = new BlacklistManager('user', target.id);
      await blacklistManager.addBlacklist({
        hubId: hub.id,
        reason,
        expiresAt,
        moderatorId: mod.id,
      });

      await blacklistManager.log(hub.id, message.client, {
        mod,
        reason,
        expiresAt,
      });
      await sendBlacklistNotif('user', message.client, {
        target,
        hubId: hub.id,
        expiresAt,
        reason,
      }).catch(() => null);
    }

    await message.react(getEmoji('timeout', message.client)).catch(() => null);
    return { passed: false };
  }
  return { passed: true };
}

async function checkNewUser(
  message: Message<true>,
  opts: HubCheckFunctionOpts,
): Promise<CheckResult> {
  const sevenDaysAgo = Date.now() - 1000 * 60 * 60 * 24 * 7;

  if (message.author.createdTimestamp > sevenDaysAgo) {
    const locale = await fetchUserLocale(opts.userData);
    return {
      passed: false,
      reason: t('network.accountTooNew', locale, {
        user: message.author.toString(),
        emoji: getEmoji('x_icon', message.client),
      }),
    };
  }

  return { passed: true };
}

const MAX_MESSAGE_LENGTH = {
  DEFAULT: 800,
  VOTER: 2000,
};

async function checkMessageLength(
  message: Message<true>,
  { userData }: HubCheckFunctionOpts,
): Promise<CheckResult> {
  const isVoter = await new UserDbService().userVotedToday(message.author.id, userData);
  const maxLength = isVoter ? MAX_MESSAGE_LENGTH.VOTER : MAX_MESSAGE_LENGTH.DEFAULT;

  if (message.content.length > maxLength) {
    return {
      passed: false,
      reason: `${getEmoji('x_icon', message.client)} Messages cannot exceed ${maxLength} characters. ${!isVoter ? `Vote for InterChat to send longer messages (up to ${MAX_MESSAGE_LENGTH.VOTER} characters)!` : ''}`,
    };
  }
  return { passed: true };
}

async function checkInviteLinks(
  message: Message<true>,
  opts: HubCheckFunctionOpts,
): Promise<CheckResult> {
  const { settings, userData } = opts;

  if (settings.has('BlockInvites') && containsInviteLinks(message.content)) {
    const locale = await fetchUserLocale(userData);
    const emoji = getEmoji('x_icon', message.client);
    return {
      passed: false,
      reason: t('errors.inviteLinks', locale, { emoji }),
    };
  }
  return { passed: true };
}

function checkAttachments(message: Message<true>): CheckResult {
  const attachment = message.attachments.first();
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

  if (attachment?.contentType && !allowedTypes.includes(attachment.contentType)) {
    return {
      passed: false,
      reason: 'Only images and tenor gifs are allowed to be sent within the network.',
    };
  }

  if (attachment && attachment.size > 1024 * 1024 * 8) {
    return { passed: false, reason: 'Please keep your attachments under 8MB.' };
  }

  return { passed: true };
}

async function checkNSFW(
  message: Message<true>,
  { attachmentURL }: { attachmentURL?: string | null },
): Promise<CheckResult> {
  if (attachmentURL && Constants.Regex.StaticImageUrl.test(attachmentURL)) {
    const predictions = await new NSFWDetector(attachmentURL).analyze();
    if (predictions.isNSFW && predictions.exceedsSafeThresh()) {
      const nsfwEmbed = new EmbedBuilder()
        .setColor(Constants.Colors.invisible)
        .setDescription(
          stripIndents`
          ### ${getEmoji('exclamation', message.client)} NSFW Image Blocked
          Images that contain NSFW (Not Safe For Work) content are not allowed on InterChat and may result in a blacklist from the hub and bot.
          `,
        )
        .setFooter({
          text: `Notification sent for: ${message.author.username}`,
          iconURL: message.author.displayAvatarURL(),
        });

      await replyToMsg(message, { embed: nsfwEmbed });
      return { passed: false };
    }
  }
  return { passed: true };
}

async function checkStickers(
  message: Message<true>,
  { userData }: HubCheckFunctionOpts,
): Promise<CheckResult> {
  if (message.stickers.size > 0) {
    const isVoter = await new UserDbService().userVotedToday(message.author.id, userData);
    if (!isVoter) {
      return {
        passed: false,
        reason: `${getEmoji('x_icon', message.client)} Sending stickers is a voter-only perk! Vote at ${Constants.Links.Vote} to unlock this feature.`,
      };
    }
  }
  return { passed: true };
}

// Modified spam check for calls
async function checkSpamForCalls(message: Message<true>): Promise<CheckResult> {
  const result = await message.client.antiSpamManager.handleMessage(message);

  if (result) {
    await message.react(getEmoji('timeout', message.client)).catch(() => null);
    return { passed: false };
  }

  return { passed: true };
}

// New function to check URLs in calls (blocks all except Tenor)
function checkURLsForCalls(message: Message<true>): CheckResult {
  // Allow Tenor URLs
  if (Constants.Regex.TenorLinks.test(message.content)) {
    return { passed: true };
  }

  // Block all other URLs
  if (Constants.Regex.Links.test(message.content)) {
    return {
      passed: false,
      reason:
        'Links are not allowed during calls for security reasons. Only Tenor GIFs are permitted.',
    };
  }

  return { passed: true };
}

// New function to check GIFs in calls
function checkGifsForCalls(message: Message<true>): CheckResult {
  const attachment = message.attachments.first();

  // Block non-Tenor GIFs
  if (attachment?.contentType?.includes('gif') && !message.content.includes('tenor.com')) {
    return {
      passed: false,
      reason: 'Only Tenor GIFs are allowed during calls. Please use Tenor for sharing GIFs.',
    };
  }

  return { passed: true };
}
