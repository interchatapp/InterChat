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

import type Context from '#src/core/CommandContext/Context.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { fetchCommands, findCommand } from '#utils/CommandUtils.js';
import { updateConnection } from '#utils/ConnectedListUtils.js';
import db from '#utils/Db.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { t } from '#utils/Locale.js';
import {
  ApplicationCommandOptionType,
  channelMention,
  chatInputApplicationCommandMention as slashCmdMention,
} from 'discord.js';
import BaseCommand from '#src/core/BaseCommand.js';

export default class ConnectionPauseSubcommand extends BaseCommand {
  constructor() {
    super({
      name: 'pause',
      description: '⏸️ Temporarily stop messages from coming into any channel connected to a hub.',
      types: { prefix: true, slash: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'channel',
          description: 'The name of the channel to pause connection',
          required: false,
          autocomplete: true,
        },
      ],

    });
  }
  override async execute(ctx: Context): Promise<void> {
    const channelId = ctx.options.getString('channel') ?? ctx.channelId;
    const connected = await db.connection.findFirst({ where: { channelId } });

    const locale = await fetchUserLocale(ctx.user.id);

    if (!connected) {
      await ctx.reply({
        content: `${ctx.getEmoji('x_icon')} That channel is not connected to a hub!`,
        flags: ['Ephemeral'],
      });
      return;
    }

    if (!connected.connected) {
      const embed = new InfoEmbed().setDescription(
        `${ctx.getEmoji('x_icon')} The connection is already paused for this channel. Use \`/connection unpause\` to continue chatting.`,
      );
      await ctx.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return;
    }

    // disconnect the channel
    await updateConnection({ channelId }, { connected: false });

    const commands = await fetchCommands(ctx.client);
    const connectionCmd = findCommand('connection', commands);
    const hubCmd = findCommand('hub', commands);

    const unpause_cmd = connectionCmd
      ? slashCmdMention('connection', 'unpause', connectionCmd.id)
      : '`/connection unpause`';
    const leave_cmd = hubCmd ? slashCmdMention('hub', 'leave', hubCmd.id) : '`/disconnect`';

    const successEmbed = new InfoEmbed().removeTitle().setDescription(
      t('connection.paused.desc', locale, {
        clock_emoji: ctx.getEmoji('timeout'),
        channel: channelMention(channelId),
      }),
    );

    await ctx.reply({
      content: t('connection.paused.tips', locale, { unpause_cmd, leave_cmd }),
      embeds: [successEmbed],
    });
  }
}
