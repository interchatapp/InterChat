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
import { UIComponents } from '#src/utils/DesignSystem.js';
import { formatVotingLeaderboard, getVotingLeaderboard } from '#src/utils/Leaderboard.js';
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';

export default class VotesLeaderboardCommand extends BaseCommand {
  constructor() {
    super({
      name: 'votes',
      description: 'Shows the global voting leaderboard for InterChat.',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context) {
    const leaderboard = await getVotingLeaderboard(10);
    const leaderboardTable = await formatVotingLeaderboard(leaderboard, ctx.client);

    // Create UI components helper
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader(
        'Global Voting Leaderboard',
        'Resets every month. Vote on top.gg to get on it!',
        'topggSparkles',
      ),
    );

    // Add leaderboard content
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        leaderboardTable.length > 0 ? leaderboardTable : 'No voting data available.',
      ),
    );

    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }
}
