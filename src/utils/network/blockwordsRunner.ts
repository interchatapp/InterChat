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

import { type BlockWord, BlockWordAction } from '@prisma/client';
import type { ActionRowBuilder, Awaitable, ButtonBuilder, Message } from 'discord.js';
import Logger from '#src/utils/Logger.js';
import { logBlockwordAlert } from '#src/utils/hub/logger/BlockWordAlert.js';
import { sendBlacklistNotif } from '#src/utils/moderation/blacklistUtils.js';
import { createRegexFromWords } from '#utils/moderation/antiSwear.js';
import type { CheckResult } from '#src/utils/network/runChecks.js';

// Interface for action handler results
interface ActionResult {
  success: boolean;
  shouldBlock: boolean;
  components?: ActionRowBuilder<ButtonBuilder>[];
  message?: string;
}

// Action handler type
type ActionHandler = (
  message: Message<true>,
  rule: BlockWord,
  matches: string[],
) => Awaitable<ActionResult>;

// Map of action handlers
const actionHandlers: Record<BlockWordAction, ActionHandler> = {
  [BlockWordAction.BLOCK_MESSAGE]: () => ({
    success: true,
    shouldBlock: true,
    message: 'Message blocked due to containing prohibited words.',
  }),

  [BlockWordAction.SEND_ALERT]: async (message, rule, matches) => {
    // Send alert to moderators
    await logBlockwordAlert(message, rule, matches);
    return { success: true, shouldBlock: false };
  },

  [BlockWordAction.BLACKLIST]: async (message, rule) => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const reason = `Auto-blacklisted for using blocked words (Rule: ${rule.name})`;
    const target = message.author;
    const mod = message.client.user;

    const blacklistManager = new BlacklistManager('user', target.id);
    await blacklistManager.addBlacklist({
      hubId: rule.hubId,
      reason,
      expiresAt,
      moderatorId: mod.id,
    });

    await blacklistManager.log(rule.hubId, message.client, {
      mod,
      reason,
      expiresAt,
    });
    await sendBlacklistNotif('user', message.client, {
      target,
      hubId: rule.hubId,
      expiresAt,
      reason,
    }).catch(() => null);

    return {
      success: true,
      shouldBlock: true,
      message: 'You have been blacklisted for using prohibited words.',
    };
  },
};

interface ActionResult {
  success: boolean;
  shouldBlock: boolean;
  message?: string;
}

interface BlockResult {
  shouldBlock: boolean;
  reason?: string;
}

export async function checkBlockedWords(
  message: Message<true>,
  msgBlockList: BlockWord[],
): Promise<CheckResult> {
  if (msgBlockList.length === 0) return { passed: true };

  for (const rule of msgBlockList) {
    const { shouldBlock, reason } = await checkRule(message, rule);

    if (shouldBlock) {
      return {
        passed: false,
        reason,
      };
    }
  }

  return { passed: true };
}

async function executeAction(
  action: keyof typeof actionHandlers,
  message: Message<true>,
  rule: BlockWord,
  matches: RegExpMatchArray,
): Promise<ActionResult> {
  const handler = actionHandlers[action];
  if (!handler) return { success: false, shouldBlock: false };

  try {
    return await handler(message, rule, matches);
  }
  catch (error) {
    Logger.error(`Failed to execute action ${action}:`, error);
    return { success: false, shouldBlock: false };
  }
}

async function processActions(
  message: Message<true>,
  triggeredRule: BlockWord,
  matches: RegExpMatchArray,
): Promise<BlockResult> {
  if (!triggeredRule.actions.length) return { shouldBlock: false };

  for (const actionToTake of triggeredRule.actions) {
    const result = await executeAction(actionToTake, message, triggeredRule, matches);
    if (result.success && result.shouldBlock) {
      return {
        shouldBlock: true,
        reason: result.message,
      };
    }
  }

  return { shouldBlock: false };
}

async function checkRule(message: Message<true>, rule: BlockWord): Promise<BlockResult> {
  const regex = createRegexFromWords(rule.words);
  const matches = message.content.match(regex);

  if (!matches) return { shouldBlock: false };

  return await processActions(message, rule, matches);
}
