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
import UserDbService from '#src/services/UserDbService.js';
import { fetchUserData, fetchUserLocale } from '#src/utils/Utils.js';
import Constants from '#utils/Constants.js';
import { t } from '#utils/Locale.js';
import { stripIndents } from 'common-tags';
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
      description: t('voteCommand.description', 'en'),
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context) {
    const { id } = ctx.user;
    const userData = await fetchUserData(id);
    const voteCount = String(userData?.voteCount ?? 0);
    const locale = userData ? await fetchUserLocale(userData) : 'en';
    const hasVoted = await new UserDbService().userVotedToday(id, userData ?? undefined);

    const voteStatusEmoji = ctx.getEmoji(hasVoted ? 'tick_icon' : 'slash');

    const perksEmbed = new EmbedBuilder()
      .setAuthor({ name: t('vote.embed.title', locale) })
      .setDescription(t('vote.description', locale))
      .setFields(
        {
          name: `${ctx.getEmoji('topggSparkles')} ${t('vote.fields.currentStreak', locale)}`,
          value: codeBlock(voteCount),
          inline: true,
        },
        {
          name: t('vote.fields.lastVote', locale),
          value: userData?.lastVoted
            ? time(userData.lastVoted, 'R')
            : t('vote.fields.voteNow', locale, { vote_url: Constants.Links.Vote }),
          inline: true,
        },
        {
          name: t('vote.fields.voterPerks', locale),
          value: stripIndents`
            ${voteStatusEmoji} ${t('vote.fields.perks.messageLength', locale)}
            ${voteStatusEmoji} ${t('vote.fields.perks.stickers', locale)}
            ${voteStatusEmoji} ${t('vote.fields.perks.createHubs', locale)}
            ${voteStatusEmoji} ${t('vote.fields.perks.welcomeMessages', locale)}
            ${voteStatusEmoji} ${t('vote.fields.perks.voterRole', locale)}
            ${voteStatusEmoji} ${t('vote.fields.perks.voterBadge', locale)}
            -# ${t('vote.perks.moreComingSoon', locale, { support_invite: Constants.Links.SupportInvite })}
            `,
        },
      )
      .setColor(hasVoted ? 'Green' : Constants.Colors.invisible)
      .setFooter({
        text: t('vote.footer', locale),
        iconURL: 'https://i.imgur.com/NKKmav5.gif',
      });

    const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(t('vote.button.label', locale))
        .setEmoji(ctx.getEmoji('topggSparkles'))
        .setURL(Constants.Links.Vote),
    );

    await ctx.reply({ embeds: [perksEmbed], components: [button] });
  }
}
