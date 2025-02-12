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

import { ApplicationCommandOptionType } from 'discord.js';
import BaseCommand from '#src/core/BaseCommand.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import UserDbService from '#src/services/UserDbService.js';
import type Context from '#src/core/CommandContext/Context.js';

export default class Unban extends BaseCommand {
  constructor() {
    super({
      name: 'unban',
      description: '🔨 Unban a user from using the bot (Staff Only',
      staffOnly: true,
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: '👤 The user to unban',
          required: true,
        },
      ],
    });
  }

  async execute(ctx: Context) {
    const user = await ctx.options.getUser('user');

    if (!user) {
      await ctx.reply('User not found');
      return;
    }

    const userService = new UserDbService();
    const alreadyBanned = await userService.getUser(user.id);

    if (!alreadyBanned?.banReason) {
      const notBannedEmbed = new InfoEmbed().setDescription(
        `${ctx.getEmoji('slash')} User **${user.username}** is not banned.`,
      );
      await ctx.reply({ embeds: [notBannedEmbed] });
      return;
    }

    await userService.unban(user.id, user.username);

    const unbanEmbed = new InfoEmbed().setDescription(
      `${ctx.getEmoji('tick')} Successfully unbanned \`${user.username}\`. They can use the bot again.`,
    );
    await ctx.reply({ embeds: [unbanEmbed] });
  }
}
