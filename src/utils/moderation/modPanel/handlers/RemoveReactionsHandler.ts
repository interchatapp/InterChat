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

import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { type ModAction, replyWithUnknownMessage } from '#src/utils/moderation/modPanel/utils.js';
import { getOriginalMessage } from '#src/utils/network/messageUtils.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import type { ReactionArray } from '#types/Utils.d.ts';
import { updateReactions } from '#utils/reaction/reactions.js';
import sortReactions from '#utils/reaction/sortReactions.js';
import type { Snowflake } from 'discord.js';

export default class RemoveReactionsHandler implements ModAction {
  async handle(ctx: ComponentContext, originalMsgId: Snowflake) {
    await ctx.deferReply({ flags: ['Ephemeral'] });

    const originalMsg = await getOriginalMessage(originalMsgId);
    if (!originalMsg) {
      await replyWithUnknownMessage(ctx, {
        locale: await fetchUserLocale(ctx.user.id),
      });
      return;
    }

    let reactions: ReactionArray;

    try {
      reactions = originalMsg.reactions ? originalMsg.reactions as { [key: string]: string[] } : {};
    }
    catch {
      // Fallback to empty object if parsing fails
      reactions = {};
    }

    if (!sortReactions(reactions).length) {
      await ctx.reply({
        content: `${getEmoji('slash', ctx.client)} No reactions to remove.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    await updateReactions(originalMsg, {});

    await ctx.reply({
      content: `${getEmoji('tick_icon', ctx.client)} Reactions removed.`,
      flags: ['Ephemeral'],
    });
  }
}
