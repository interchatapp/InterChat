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

import ConfigSetInviteSubcommand from '#src/commands/Main/config/set-invite.js';
import BaseCommand from '#src/core/BaseCommand.js';
import { PermissionsBitField } from 'discord.js';
export default class ConfigCommand extends BaseCommand {
  constructor() {
    super({
      name: 'config',
      description: 'Configure Server settings for InterChat.',
      types: { slash: true, prefix: true },
      defaultPermissions: new PermissionsBitField('ManageMessages'),
      subcommands: {
        'set-invite': new ConfigSetInviteSubcommand(),
      },
    });
  }
}
