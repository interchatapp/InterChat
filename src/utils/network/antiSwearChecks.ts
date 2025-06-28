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
import AntiSwearManager from '#src/managers/AntiSwearManager.js';
import { BlockWordAction } from '#src/generated/prisma/client/client.js';
import type { Awaitable, Message } from 'discord.js';
import Logger from '#src/utils/Logger.js';
import { logAntiSwearAlert, type AntiSwearRule } from '#src/utils/hub/logger/AntiSwearAlert.js';
import { sendBlacklistNotif } from '#src/utils/moderation/blacklistUtils.js';
import type { CheckResult } from '#src/utils/network/runChecks.js';

// Interface for action handler results
interface ActionResult {
  success: boolean;
  shouldBlock: boolean;
  message?: string;
}

// Action handler type
type ActionHandler = (
  message: Message<true>,
  ruleId: string,
  hubId: string,
  ruleName: string,
  matches: string[],
) => Awaitable<ActionResult>;

// Map of action handlers
const actionHandlers: Record<BlockWordAction, ActionHandler> = {
  [BlockWordAction.BLOCK_MESSAGE]: () => ({
    success: true,
    shouldBlock: true,
    message: 'Message blocked due to containing prohibited words.',
  }),

  [BlockWordAction.SEND_ALERT]: async (message, ruleId, hubId, ruleName, matches) => {
    try {
      // Create a rule object with the required properties for the alert system
      const ruleObject: AntiSwearRule = {
        id: ruleId,
        hubId,
        name: ruleName,
        actions: [BlockWordAction.SEND_ALERT],
      };

      // Send alert to moderators
      await logAntiSwearAlert(message, ruleObject, matches);
      return { success: true, shouldBlock: false };
    }
    catch (error) {
      Logger.error('Failed to send anti-swear alert:', error);
      return { success: false, shouldBlock: false };
    }
  },

  [BlockWordAction.BLACKLIST]: async (message, _ruleId, hubId, ruleName) => {
    try {
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      const reason = `Auto-blacklisted for using prohibited words (Rule: ${ruleName}).\n**Proof:** ${message.cleanContent}`;
      const target = message.author;
      const mod = message.client.user;

      const blacklistManager = new BlacklistManager('user', target.id);
      await blacklistManager.addBlacklist({
        hubId,
        reason,
        expiresAt,
        moderatorId: mod.id,
      });

      await blacklistManager.log(hubId, message.client, {
        mod,
        reason,
        expiresAt,
      });

      await sendBlacklistNotif('user', message.client, {
        target,
        hubId,
        expiresAt,
        reason,
      }).catch(() => null);

      return {
        success: true,
        shouldBlock: true,
        message: 'You have been blacklisted for using prohibited words.',
      };
    }
    catch (error) {
      Logger.error('Failed to blacklist user for anti-swear violation:', error);
      return { success: false, shouldBlock: true };
    }
  },
};

/**
 * Check if a message contains prohibited words and execute appropriate actions
 */
export async function checkAntiSwear(
  message: Message<true>,
  hubId: string,
): Promise<CheckResult> {
  // Skip empty messages
  if (!message.content.trim()) {
    return { passed: true };
  }

  const antiSwearManager = AntiSwearManager.getInstance();
  const start = performance.now();
  const { blocked, rule, matches } = await antiSwearManager.checkMessage(message.content, hubId);
  Logger.debug(`Anti-swear check for message ${message.id} took ${performance.now() - start}ms`);

  if (blocked && rule) {
    // Process actions for the matched rule
    let shouldBlock = false;
    let blockReason: string | undefined;

    // Execute all actions for the rule
    for (const action of rule.actions) {
      const result = await executeAction(action, message, rule.id, rule.hubId, rule.name, matches);

      if (result.success && result.shouldBlock) {
        shouldBlock = true;
        blockReason = result.message;
      }
    }

    if (shouldBlock) {
      return { passed: false, reason: blockReason };
    }
  }

  return { passed: true };
}

/**
 * Execute a specific action for an anti-swear rule
 */
async function executeAction(
  action: BlockWordAction,
  message: Message<true>,
  ruleId: string,
  hubId: string,
  ruleName: string,
  matches: string[],
): Promise<ActionResult> {
  const handler = actionHandlers[action];
  if (!handler) {
    return { success: false, shouldBlock: false };
  }

  try {
    return await handler(message, ruleId, hubId, ruleName, matches);
  }
  catch (error) {
    Logger.error(`Failed to execute action ${action}:`, error);
    return { success: false, shouldBlock: false };
  }
}

/**
 * Check if a string contains prohibited words
 * Used for checking server names, etc.
 */
export async function checkStringForAntiSwear(
  content: string,
  hubId: string,
): Promise<boolean> {
  if (!content.trim()) {
    return false;
  }

  const antiSwearManager = AntiSwearManager.getInstance();
  const { blocked } = await antiSwearManager.checkMessage(content, hubId);

  return blocked;
}
