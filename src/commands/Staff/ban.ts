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

import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import { handleBan } from '#utils/BanUtils.js';
import {
  ApplicationCommandOptionType,
} from 'discord.js';

export default class Ban extends BaseCommand {
  constructor() {
    super({
      name: 'ban',
      description: '🔨 Ban a user from using the bot. (Dev Only)',
      staffOnly: true,
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: '🔨 The user to ban.',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'reason',
          description: 'Reason for the ban',
          required: true,
        },
      ],
    });
  }

  async execute(ctx: Context) {
    const user = await ctx.options.getUser('user');
    const reason = ctx.options.getString('reason', true);

    if (!user) {
      await ctx.reply('User not found');
      return;
    }

    await handleBan(ctx, user.id, user, reason);
  }
}
