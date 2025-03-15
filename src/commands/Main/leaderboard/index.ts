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

import CallsLeaderboardCommand from '#src/commands/Main/hub/leaderboard/calls.js';
import ServerLeaderboardCommand from '#src/commands/Main/leaderboard/server.js';
import UserLeaderboardCommand from '#src/commands/Main/leaderboard/user.js';
import BaseCommand from '#src/core/BaseCommand.js';
export default class LeaderboardCommand extends BaseCommand {
  constructor() {
    super({
      name: 'leaderboard',
      description: 'leaderboard rahhh',
      types: { slash: true, prefix: true },
      subcommands: {
        user: new UserLeaderboardCommand(),
        server: new ServerLeaderboardCommand(),
        calls: new CallsLeaderboardCommand(),
      },
    });
  }
}
