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
import NSFWDetector from '#src/utils/NSFWDetection.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Constants from '#utils/Constants.js';
import Logger from '#utils/Logger.js';
import { stripIndents } from 'common-tags';
import { type Awaitable, EmbedBuilder, type Message } from 'discord.js';

export interface CheckResult {
  passed: boolean;
  reason?: string;
}

interface CallCheckFunctionOpts {
  userData: DbUser;
  attachmentURL?: string | null;
  callId: string; // Call ID for media usage tracking
}

type CallCheckFunction = (
  message: Message<true>,
  opts: CallCheckFunctionOpts,
) => Awaitable<CheckResult>;

// Call-specific checks - order matters for performance
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

export const runCallChecks = async (
  message: Message<true>,
  opts: {
    userData: DbUser;
    attachmentURL?: string | null;
    callId: string;
  },
): Promise<boolean> => {
  for (const check of callChecks) {
    const checkStartTime = performance.now();
    const result = await check(message, opts);
    const checkDuration = performance.now() - checkStartTime;

    if (!result.passed) {
      // Log failed check with timing information
      Logger.debug(`Call message ${message.id} failed check: ${check.name} (${checkDuration}ms)`);

      if (result.reason) {
        await replyToMsg(message, { content: result.reason });
      }

      return false;
    }
    Logger.debug(`Call message ${message.id} passed check: ${check.name} in ${checkDuration}ms`);
  }

  return true;
};

// Modified spam check for calls
async function checkSpamForCalls(message: Message<true>): Promise<CheckResult> {
  const result = await message.client.antiSpamManager.handleMessage(message);

  if (result) {
    await message.react(getEmoji('timeout', message.client)).catch(() => null);
    return { passed: false };
  }

  return { passed: true };
}

// Check URLs in calls (blocks all except Tenor)
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

// Check GIFs in calls (only allow Tenor)
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

// Check NSFW content in calls
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
          Images that contain NSFW (Not Safe For Work) content are not allowed in InterChat calls and may result in restrictions.
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
