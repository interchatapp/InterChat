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
import type Context from '#src/core/CommandContext/Context.js';
import BaseCommand from '#src/core/BaseCommand.js';
import { ApplicationCommandOptionType } from 'discord.js';

export default class ReplyMention extends BaseCommand {
  constructor() {
    super({
      name: 'reply_mentions',
      description: '🔔 Get pinged when someone replies to your messages.',
      types: { slash: true },
      options: [
        {
          type: ApplicationCommandOptionType.Boolean,
          name: 'enable',
          description: 'Enable this setting',
          required: true,
        },
      ],
    });
  }

  async execute(ctx: Context) {

    const userService = new UserDbService();
    const dbUser = await userService.getUser(ctx.user.id);

    const mentionOnReply = ctx.options.getBoolean('enable') ?? false;
    if (!dbUser) {
      await userService.createUser({
        id: ctx.user.id,
        name: ctx.user.username,
        mentionOnReply,
      });
    }
    else {
      await userService.updateUser(ctx.user.id, { mentionOnReply });
    }

    await ctx.replyEmbed(
      `${ctx.getEmoji('tick')} You will ${mentionOnReply ? 'now' : '**no longer**'} get pinged when someone replies to your messages.`,
      { flags: ['Ephemeral'] },
    );
  }
}
