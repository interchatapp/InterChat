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
import { fetchUserData, fetchUserLocale } from '#src/utils/Utils.js';
import Constants from '#utils/Constants.js';
import { t } from '#utils/Locale.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  codeBlock,
  time,
} from 'discord.js';

export default class Vote extends BaseCommand {
  constructor() {
    super({
      name: 'vote',
      description: '✨ Voting perks and vote link.',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context) {
    const { id } = ctx.user;
    const userData = await fetchUserData(id);
    const voteCount = String(userData?.voteCount ?? 0);
    const locale = userData ? await fetchUserLocale(userData) : 'en';

    const embed = new EmbedBuilder()
      .setDescription(t('vote.description', locale))
      .setFooter({
        text: t('vote.footer', locale),
        iconURL: 'https://i.imgur.com/NKKmav5.gif',
      })
      .setFields(
        {
          name: `${ctx.getEmoji('topggSparkles')} Current Streak:`,
          value: codeBlock(voteCount),
          inline: true,
        },
        {
          name: 'Last Vote',
          value: userData?.lastVoted
            ? time(userData.lastVoted, 'R')
            : `[Vote Now](${Constants.Links.Vote})!`,
          inline: true,
        },
      )
      .setColor(Constants.Colors.invisible);

    const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Vote')
        .setEmoji(ctx.getEmoji('topggSparkles'))
        .setURL(Constants.Links.Vote),
    );

    await ctx.reply({ embeds: [embed], components: [button] });
  }
}
