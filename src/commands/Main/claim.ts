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
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

export default class ClaimCommand extends BaseCommand {
  constructor() {
    super({
      name: 'claim',
      description: 'Claim your Ko-fi premium subscription benefits',
      types: { slash: true },
    });
  }

  async execute(ctx: Context): Promise<void> {
    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Claim Ko-fi Premium Benefits')
          .setDescription(
            stripIndents`
                Visit the **dashboard** to claim your Ko-fi premium benefits.
                If you have not donated, you can do so at [Ko-fi](https://ko-fi.com/interchat).
            `,
          )
          .setColor('#ffcc00')
          .setFooter({ text: 'Thank you for supporting InterChat!' }),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('Dashboard')
            .setURL(`${Constants.Links.Website}/dashboard/settings`)
            .setStyle(ButtonStyle.Link),
        ),
      ],
    });
  }
}
