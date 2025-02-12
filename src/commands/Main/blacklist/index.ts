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

import BlacklistListSubcommand from '#src/commands/Main/blacklist/list.js';
import BlacklistServerSubcommand from '#src/commands/Main/blacklist/server.js';
import BlacklistUserSubcommand from '#src/commands/Main/blacklist/user.js';
import BaseCommand from '#src/core/BaseCommand.js';

export default class BlacklistCommand extends BaseCommand {
  constructor() {
    super({
      name: 'blacklist',
      description: 'Mute/Ban a user or server from your hub.',
      types: { prefix: true, slash: true },
      subcommands: {
        user: new BlacklistUserSubcommand(),
        server: new BlacklistServerSubcommand(),
        list: new BlacklistListSubcommand(),
      },
    });
  }
}
