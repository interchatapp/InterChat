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

import ConnectionEditSubcommand from '#src/commands/Main/connection/edit.js';
import ConnectionListSubcommand from '#src/commands/Main/connection/list.js';
import ConnectionPauseSubcommand from '#src/commands/Main/connection/pause.js';
import ConnectionUnpauseSubcommand from '#src/commands/Main/connection/unpause.js';
import BaseCommand from '#src/core/BaseCommand.js';
import db from '#utils/Db.js';
import { escapeRegexChars } from '#utils/Utils.js';
import {
  type AutocompleteInteraction,
  PermissionsBitField,
} from 'discord.js';

export default class ConnectionCommand extends BaseCommand {
  constructor() {
    super({
      name: 'connection',
      description: 'Pause, unpause or edit your connections to hubs in this server.',
      types: { prefix: true, slash: true },
      defaultPermissions: new PermissionsBitField('SendMessages'),
      contexts: { guildOnly: true },
      subcommands: {
        edit: new ConnectionEditSubcommand(),
        pause: new ConnectionPauseSubcommand(),
        unpause: new ConnectionUnpauseSubcommand(),
        list: new ConnectionListSubcommand(),
      },
    });
  }

  static async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focusedValue = escapeRegexChars(interaction.options.getFocused());

    const isInDb = await db.connection.findMany({
      where: {
        serverId: interaction.guild?.id,
        OR: [
          { channelId: { contains: focusedValue } },
          { hub: { name: { contains: focusedValue } } },
        ],
      },
      select: { channelId: true, hub: true },
      take: 25,
    });

    const filtered = isInDb?.map(async ({ channelId, hub }) => {
      const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
      return {
        name: `${hub?.name} | #${channel?.name ?? channelId}`,
        value: channelId,
      };
    });

    await interaction.respond(await Promise.all(filtered));
  }
}
