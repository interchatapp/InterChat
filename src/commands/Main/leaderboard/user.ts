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
import Constants from '#src/utils/Constants.js';
import { formatUserLeaderboard, getLeaderboard } from '#src/utils/Leaderboard.js';
import { resolveColor } from 'discord.js';

export default class UserLeaderboardCommand extends BaseCommand {
  constructor() {
    super({
      name: 'user',
      description: 'Shows the global user leaderboard for InterChat (with messages).',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context) {
    const leaderboard = await getLeaderboard('user', 10);
    const leaderboardTable = await formatUserLeaderboard(leaderboard, ctx.client);

    await ctx.reply({
      embeds: [
        {
          title: `${ctx.getEmoji('hash_icon')} Global User Leaderboard`,
          description: leaderboardTable,
          color: resolveColor(Constants.Colors.invisible),
          footer: { text: 'Resets every month. Send a message in any hub to get on it!' },
        },
      ],
    });
  }
}
