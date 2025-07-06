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

import type { User as DbUser } from '#src/generated/prisma/client/client.js';
import BlacklistManager from '#src/managers/BlacklistManager.js';
import type HubManager from '#src/managers/HubManager.js';
import type HubSettingsManager from '#src/managers/HubSettingsManager.js';
import ServerBanManager from '#src/managers/ServerBanManager.js';
import BanManager from '#src/managers/UserBanManager.js';
import UserDbService from '#src/services/UserDbService.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { sendBlacklistNotif } from '#src/utils/moderation/blacklistUtils.js';
import { checkAntiSwear as checkAntiSwearFunction } from '#src/utils/network/antiSwearChecks.js';
import NSFWDetector from '#src/utils/NSFWDetection.js';
import Constants, { RedisKeys } from '#utils/Constants.js';
import { t } from '#utils/Locale.js';
import Logger from '#utils/Logger.js';
import { getRedis } from '#utils/Redis.js';
import { containsInviteLinks, fetchUserLocale, hashString, replaceLinks } from '#utils/Utils.js';
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

// ordering is important - always check blacklists first (or they can bypass)
const checks: CheckFunction[] = [
  checkBanAndBlacklist,
  checkAntiSwear,
  checkHubLock,
  checkSpam,
  checkNewUser,
  checkMessageLength,
  checkInviteLinks,
  checkLinks, // before checkAttachments to ensure links are processed first
  checkAttachments,
  checkNSFW,
  checkStickers,
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

const runCheckWithTiming = async (
  message: Message<true>,
  check: CheckFunction,
  opts: HubCheckFunctionOpts,
): Promise<CheckResult> => {
  const checkStartTime = performance.now();
  const result = await check(message, opts);
  const resultString = result.passed ? 'passed' : 'failed';

  Logger.debug(
    `
    Check ${check.name} ${resultString} for message ${message.id} (${(performance.now() - checkStartTime).toFixed(2)}ms).
    `,
  );
  return result;
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
  Logger.debug(`Starting message checks for message ${message.id}`);

  for (const check of checks) {
    const result = await runCheckWithTiming(message, check, { ...opts, hub });

    if (!result.passed) {
      if (result.reason) await replyToMsg(message, { content: result.reason });
      return false;
    }
  }

  return true;
};

// Redis cache prefix for anti-swear check results
const ANTI_SWEAR_CACHE_PREFIX = `${RedisKeys.AntiSwear}:check`;
const ANTI_SWEAR_CACHE_TTL = 30; // 30 seconds in seconds (short TTL since content varies)

async function checkAntiSwear(
  message: Message<true>,
  { hub }: HubCheckFunctionOpts,
): Promise<CheckResult> {
  // Skip empty messages
  if (!message.content.trim()) {
    return { passed: true };
  }

  // Create a cache key that includes message content hash and hub ID
  // Using a simple hash of the content to avoid storing the full message content
  const contentHash = hashString(message.content);
  const cacheKey = `${ANTI_SWEAR_CACHE_PREFIX}:${contentHash}:${hub.id}`;
  const redis = getRedis();

  // Check Redis cache first
  const cachedResult = await redis.get(cacheKey);

  if (cachedResult !== null) {
    try {
      // Parse the cached result
      const cached = JSON.parse(cachedResult);
      return cached as CheckResult;
    }
    catch (error) {
      // If there's an error parsing the cached data, log it and continue to check
      Logger.error('Error parsing cached anti-swear check result:', error);
    }
  }

  // Cache miss - check with the antiswear system
  const result = await checkAntiSwearFunction(message, hub.id);

  // Store result in Redis cache
  await redis.set(cacheKey, JSON.stringify(result), 'EX', ANTI_SWEAR_CACHE_TTL);

  return result;
}

// Redis cache prefix for blacklist check results
const BLACKLIST_CHECK_CACHE_PREFIX = `${RedisKeys.Infraction}:blacklist_check`;
const BLACKLIST_CHECK_CACHE_TTL = 120; // 2 minutes in seconds

async function checkBanAndBlacklist(
  message: Message<true>,
  opts: HubCheckFunctionOpts,
): Promise<CheckResult> {
  // Check for global server ban first
  const serverBanManager = new ServerBanManager();
  const serverBanCheck = await serverBanManager.isServerBanned(message.guildId);
  if (serverBanCheck.isBanned) {
    return { passed: false };
  }

  // Check for global user ban
  const banManager = new BanManager();
  const banCheck = await banManager.isUserBanned(message.author.id);
  if (banCheck.isBanned) {
    return { passed: false };
  }

  // Create a cache key that includes user ID and hub ID
  const cacheKey = `${BLACKLIST_CHECK_CACHE_PREFIX}:user:${message.author.id}:${opts.hub.id}`;
  const redis = getRedis();

  // Check Redis cache first
  const cachedResult = await redis.get(cacheKey);

  if (cachedResult !== null) {
    try {
      const isBlacklisted = cachedResult === '1';
      return { passed: !isBlacklisted };
    }
    catch (error) {
      // If there's an error parsing the cached data, log it and continue to fetch
      Logger.error('Error parsing cached blacklist check result:', error);
    }
  }

  // Cache miss - check blacklist
  const blacklistManager = new BlacklistManager('user', message.author.id);
  const blacklisted = await blacklistManager.fetchBlacklist(opts.hub.id);

  // Store result in Redis cache (using '1' for true and '0' for false to save space)
  await redis.set(cacheKey, blacklisted ? '1' : '0', 'EX', BLACKLIST_CHECK_CACHE_TTL);

  if (blacklisted) {
    // If blacklisted, send notification
    if (!blacklisted.notified) {
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
        "This hub's chat has been locked. Only moderators can send messages. Please check back later as this may be temporary.",
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

  // If spam filter is not enabled, skip the check
  if (!settings.has('SpamFilter')) {
    return { passed: true };
  }

  // check with the anti-spam system
  const result = await message.client.antiSpamManager.handleMessage(message);
  if (!result) return { passed: true };

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

const MAX_ATTACHMENT_SIZE = 8 * 1024 * 1024; // 8MB
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/mov']);

// Pre-defined error messages to avoid string concatenation
const ERROR_MESSAGES = {
  SIZE_LIMIT: 'Please keep your attachments under 8MB.',
  VIDEO_DISABLED: 'Video attachments are not allowed in this hub because the "Allow Videos" setting is disabled.',
  INVALID_TYPE: 'Only images, videos (if enabled), and Tenor GIFs are allowed to be sent within this hub.',
} as const;

async function checkAttachments(
  message: Message<true>,
  opts: HubCheckFunctionOpts,
): Promise<CheckResult> {
  const attachment = message.attachments.first();
  const { attachmentURL, settings } = opts;

  // exit if no attachment to check
  if (!attachment && !attachmentURL) {
    return { passed: true };
  }

  const allowVideos = settings.has('AllowVideos');

  if (attachment) {
    // Size check first (fastest check)
    if (attachment.size > MAX_ATTACHMENT_SIZE) {
      return { passed: false, reason: ERROR_MESSAGES.SIZE_LIMIT };
    }

    // Type check only if contentType exists
    if (attachment.contentType) {
      const isVideo = ALLOWED_VIDEO_TYPES.has(attachment.contentType);

      // Fast video check
      if (isVideo && !allowVideos) {
        return { passed: false, reason: ERROR_MESSAGES.VIDEO_DISABLED };
      }

      // Only check image types if it's not a video
      if (!isVideo && !ALLOWED_IMAGE_TYPES.has(attachment.contentType)) {
        return { passed: false, reason: ERROR_MESSAGES.INVALID_TYPE };
      }
    }
  }

  // Check attachment URL
  if (attachmentURL) {
    // Use regex test directly without intermediate variables
    if (Constants.Regex.VideoURL.test(attachmentURL)) {
      if (!allowVideos) {
        return { passed: false, reason: ERROR_MESSAGES.VIDEO_DISABLED };
      }
    }
    else if (!Constants.Regex.ImageURL.test(attachmentURL)) {
      return { passed: false, reason: ERROR_MESSAGES.INVALID_TYPE };
    }
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
