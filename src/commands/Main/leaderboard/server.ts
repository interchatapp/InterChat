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
import { formatServerLeaderboard, getLeaderboard } from '#src/utils/Leaderboard.js';
import { resolveColor } from 'discord.js';

export default class ServerLeaderboardCommand extends BaseCommand {
  constructor() {
    super({
      name: 'server',
      description: 'Shows the global server leaderboard for InterChat (with invites).',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context) {
    const leaderboard = await getLeaderboard('server', 10);
    const leaderboardTable = await formatServerLeaderboard(leaderboard, ctx.client);

    await ctx.reply({
      embeds: [
        {
          title: `${ctx.getEmoji('hash_icon')} Global Server Leaderboard`,
          description: leaderboardTable,
          color: resolveColor(Constants.Colors.invisible),
          footer: { text: 'Resets every month. Send a message in any hub to get on it!' },
        },
      ],
    });
  }
}
