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

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  WebhookClient,
} from 'discord.js';
import { type OriginalMessage, getBroadcasts } from '#src/utils/network/messageUtils.js';
import type { ReactionArray } from '#types/Utils.d.ts';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { getEmojiId } from '#utils/Utils.js';
import sortReactions from './sortReactions.js';

export const addReaction = (reactionArr: ReactionArray, userId: string, emoji: string): void => {
  reactionArr[emoji] = reactionArr[emoji] || [];
  reactionArr[emoji].push(userId);
};

export const removeReaction = (
  reactionArr: ReactionArray,
  userId: string,
  emoji: string,
): ReactionArray => {
  if (reactionArr[emoji]) {
    reactionArr[emoji] = reactionArr[emoji].filter((id) => id !== userId);
    if (reactionArr[emoji].length === 0) {
      delete reactionArr[emoji];
    }
  }
  return reactionArr;
};

const createReactionButtons = (
  sortedReactions: [string, string[]][],
): ActionRowBuilder<ButtonBuilder> | null => {
  if (sortedReactions.length === 0) return null;

  const [mostReaction, users] = sortedReactions[0];
  const reactionCount = users.length;
  const mostReactionEmoji = getEmojiId(mostReaction);

  if (!mostReactionEmoji) return null;

  const reactionBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(new CustomID().setIdentifier('reaction_', mostReaction).toString())
      .setEmoji(mostReactionEmoji)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(`${reactionCount}`),
  );

  const additionalReactionsCount = sortedReactions
    .slice(1)
    .filter(([, usrs]) => usrs.length > 0).length;
  if (additionalReactionsCount > 0) {
    reactionBtn.addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID().setIdentifier('reaction_', 'view_all').toString())
        .setStyle(ButtonStyle.Secondary)
        .setLabel(`+ ${additionalReactionsCount}`),
    );
  }

  return reactionBtn;
};

const updateMessageComponents = async (
  webhook: WebhookClient,
  messageId: string,
  threadId: string | undefined,
  reactionBtn: ActionRowBuilder<ButtonBuilder> | null,
): Promise<void> => {
  const message = await webhook.fetchMessage(messageId, { threadId }).catch(() => null);
  if (!message) return;

  const components =
    message.components?.filter((row) => {
      row.components = row.components.filter((component) => {
        if (component.type !== ComponentType.Button) return true;
        if (component.style !== ButtonStyle.Secondary) return true;
        const custom_id = CustomID.parseCustomId(component.custom_id);
        return custom_id.prefix !== 'reaction_' && custom_id.suffix !== 'view_all';
      });
      return row.components.length > 0;
    }) || [];

  if (reactionBtn) components.push(reactionBtn.toJSON());

  await webhook.editMessage(messageId, { components, threadId }).catch(() => null);
};

export const updateReactions = async (
  originalMessage: OriginalMessage,
  reactions: { [key: string]: string[] },
): Promise<void> => {
  const broadcastedMessages = Object.values(
    await getBroadcasts(originalMessage.messageId, originalMessage.hubId),
  );
  const connections = await db.connection.findMany({
    where: {
      channelId: { in: broadcastedMessages.map((c) => c.channelId) },
      connected: true,
    },
  });

  const sortedReactions = sortReactions(reactions);
  const reactionBtn = createReactionButtons(sortedReactions);

  for (const connection of connections) {
    const dbMsg = broadcastedMessages.find((e) => e.channelId === connection.channelId);
    if (!dbMsg) continue;

    await updateMessageComponents(
      new WebhookClient({ url: connection.webhookURL }),
      dbMsg.messageId,
      connection.parentId ? connection.channelId : undefined,
      reactionBtn,
    );
  }
};
