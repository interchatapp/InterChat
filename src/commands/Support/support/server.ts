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

import { EmbedBuilder } from 'discord.js';
import Constants from '#utils/Constants.js';
import type Context from '#src/core/CommandContext/Context.js';
import BaseCommand from '#src/core/BaseCommand.js';

export default class SupportServer extends BaseCommand {
  constructor() {
    super({
      name: 'server',
      description: 'Join the InterChat support server.',
      types: { slash: true, prefix: true },
    });
  }
  async execute(ctx: Context) {
    const embed = new EmbedBuilder()
      .setTitle('InterChat Central')
      .setDescription(`[Click Here](${Constants.Links.SupportInvite}) to join the support server.`)
      .setColor(Constants.Colors.interchat)
      .setTimestamp();
    await ctx.reply({ embeds: [embed] });
  }
}
