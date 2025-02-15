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

import Context from '#src/core/CommandContext/Context.js';
import type HubManager from '#src/managers/HubManager.js';
import { BroadcastService } from '#src/services/BroadcastService.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { t } from '#src/utils/Locale.js';
import { webhookErrorMessages } from '#src/utils/network/storeMessageData.js';
import { getHubConnections, updateConnections } from '#utils/ConnectedListUtils.js';
import { checkIfStaff, fetchUserLocale, getReplyMethod } from '#utils/Utils.js';
import type { HubModerator, Role } from '@prisma/client';
import { type RepliableInteraction, type WebhookMessageCreateOptions } from 'discord.js';

interface ValidationCheck {
  condition: boolean;
  validator: () => Promise<boolean> | boolean;
  errorMessageKey: 'hub.notManager' | 'hub.notModerator' | 'hub.notFound_mod' | 'hub.notOwner';
}

/**
 * Sends a message to all connections in a hub's network.
 * @param hubId The ID of the hub to send the message to.
 * @param message The message to send. Can be a string or a MessageCreateOptions object.
 * @returns A array of the responses from each connection's webhook.
 */
export const sendToHub = async (hubId: string, message: string | WebhookMessageCreateOptions) => {
  const connections = await getHubConnections(hubId);
  if (!connections?.length) return;

  for (const { channelId, webhookURL, parentId, connected } of connections) {
    if (!connected) continue;

    const threadId = parentId ? channelId : undefined;
    const payload =
      typeof message === 'string' ? { content: message, threadId } : { ...message, threadId };

    const { error } = await BroadcastService.sendMessage(webhookURL, payload);

    if (error && webhookErrorMessages.includes(error)) {
      await updateConnections({ channelId }, { connected: false });
    }
  }
};

export const isHubMod = (userId: string, mods: HubModerator[], checkRoles?: Role[]) =>
  mods.some((mod) => {
    if (mod.userId !== userId) return false;
    if (!checkRoles) return true;

    return checkRoles.includes(mod.role);
  });

export const isStaffOrHubMod = async (userId: string, hub: HubManager) =>
  checkIfStaff(userId) || (await hub.isMod(userId));

export const executeHubRoleChecksAndReply = async (
  hub: HubManager,
  context: Context | RepliableInteraction,
  options: {
    checkIfStaff?: boolean;
    checkIfManager?: boolean;
    checkIfMod?: boolean;
    checkIfOwner?: boolean;
  },
): Promise<boolean> => {
  const validationChecks: ValidationCheck[] = [
    {
      condition: Boolean(options.checkIfManager),
      validator: () => hub.isManager(context.user.id),
      errorMessageKey: 'hub.notManager',
    },
    {
      condition: Boolean(options.checkIfMod),
      validator: () => hub.isMod(context.user.id),
      errorMessageKey: 'hub.notModerator',
    },
    {
      condition: Boolean(options.checkIfOwner),
      validator: () => hub.isOwner(context.user.id),
      errorMessageKey: 'hub.notOwner',
    },
  ];

  if (options.checkIfStaff && checkIfStaff(context.user.id)) return true;

  for (const check of validationChecks) {
    if (!check.condition) continue;

    const isValid = await check.validator();
    if (!isValid) {
      const embed = new InfoEmbed().setDescription(
        t(check.errorMessageKey, await fetchUserLocale(context.user.id), {
          emoji: getEmoji('x_icon', context.client),
        }),
      );

      if (context instanceof Context) {
        await context.reply({ embeds: [embed], flags: ['Ephemeral'] });
      }
      else {
        const replyMethod = getReplyMethod(context);
        await context[replyMethod]({ embeds: [embed], flags: ['Ephemeral'] });
      }
      return false;
    }
  }

  return true;
};
