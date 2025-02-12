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

import BaseEventListener from '#src/core/BaseEventListener.js';
import { HubService } from '#src/services/HubService.js';
import db from '#src/utils/Db.js';
import {
  findOriginalMessage,
  storeMessage,
} from '#src/utils/network/messageUtils.js';
import { addReaction, updateReactions } from '#utils/reaction/actions.js';
import { checkBlacklists } from '#utils/reaction/helpers.js';
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';

export default class ReadctionAdd extends BaseEventListener<'messageReactionAdd'> {
  readonly name = 'messageReactionAdd';
  public async execute(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ) {
    if (user.bot || !reaction.message.inGuild()) return;

    const cooldown = reaction.client.reactionCooldowns.get(user.id);
    if (cooldown && cooldown > Date.now()) return;

    // add user to cooldown list
    user.client.reactionCooldowns.set(user.id, Date.now() + 3000);

    const originalMsg = await findOriginalMessage(reaction.message.id);

    const hubService = new HubService(db);
    const hub = originalMsg ? await hubService.fetchHub(originalMsg?.hubId) : null;

    if (!originalMsg || !hub?.settings.has('Reactions')) {
      return;
    }

    const { userBlacklisted, serverBlacklisted } = await checkBlacklists(
      hub.id,
      reaction.message.guildId,
      user.id,
    );

    if (userBlacklisted || serverBlacklisted) return;

    const reactedEmoji = reaction.emoji.toString();
    const dbReactions = (originalMsg.reactions?.valueOf() ?? {}) as {
      [key: string]: string[];
    }; // eg. { '👍': 1, '👎': 2 }
    const emojiAlreadyReacted = dbReactions[reactedEmoji] ?? [user.id];

    // max 10 reactions
    if (Object.keys(dbReactions).length >= 10) return;

    // if there already are reactions by others and the user hasn't reacted yet
    if (!emojiAlreadyReacted?.includes(user.id)) {
      addReaction(dbReactions, user.id, reactedEmoji);
    }
    // update the data with a new arr containing userId
    else {
      dbReactions[reactedEmoji] = emojiAlreadyReacted;
    }

    await storeMessage(originalMsg.messageId, {
      ...originalMsg,
      reactions: dbReactions,
    });

    reaction.users.remove(user.id).catch(() => null);
    await updateReactions(originalMsg, dbReactions);
  }
}
