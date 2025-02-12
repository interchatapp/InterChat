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
import { ApplicationCommandOptionType, Colors } from 'discord.js';

export default class Leaderboard extends BaseCommand {
  constructor() {
    super({
      name: 'leaderboard',
      description: 'Shows the leaderboard',
      types: { slash: true, prefix: true },
      options: [
        {
          name: 'type',
          description: 'The type of leaderboard to show',
          required: false,
          type: ApplicationCommandOptionType.String,
          choices: [
            { name: 'XP', value: 'xp' },
            { name: 'Level', value: 'level' },
            { name: 'Messages', value: 'messages' },
          ],
        },
      ],
    });
  }

  async execute(ctx: Context) {
    const type = (ctx.options.getString('type') ?? 'xp') as 'xp' | 'level' | 'messages';
    const leaderboard = await ctx.client.userLevels.getLeaderboard(type);

    const description = await Promise.all(
      leaderboard.map(async (user, index) => {
        const discordUser = await ctx.client.users.fetch(user.id);
        switch (type) {
          case 'level':
            return `${index + 1}. ${discordUser.username} - Level ${user.level}`;
          case 'messages':
            return `${index + 1}. ${discordUser.username} - ${user.messageCount} messages`;
          default:
            return `${index + 1}. ${discordUser.username} - Level ${user.level} (${user.xp} XP)`;
        }
      }),
    );

    const titles = {
      xp: '🏆 Global XP Leaderboard',
      level: '⭐ Global Level Leaderboard',
      messages: '💬 Global Message Count Leaderboard',
    };

    await ctx.reply({
      embeds: [{
        title: titles[type],
        description: description.join('\n'),
        color: Colors.Yellow,
      }],
    });
  }
}
