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
import Context from '#src/core/CommandContext/Context.js';
import UserDbService from '#src/services/UserDbService.js';
import Constants from '#src/utils/Constants.js';
import db from '#src/utils/Db.js';
import { getUserLeaderboardRank } from '#src/utils/Leaderboard.js';
import { fetchUserData } from '#src/utils/Utils.js';
import { formatBadges, getBadges, getVoterBadge } from '#utils/BadgeUtils.js';
import { ApplicationCommandOptionType, EmbedBuilder, time } from 'discord.js';

export default class ProfileCommand extends BaseCommand {
  constructor() {
    super({
      name: 'profile',
      description: 'View your profile or someone else\'s InterChat profile.',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'The user to view the profile of.',
          required: false,
        },
      ],
    });
  }
  async execute(ctx: Context) {
    const user = (await ctx.options.getUser('user')) ?? ctx.user;
    const userData = await fetchUserData(user.id);

    if (!userData) {
      await ctx.reply('User not found.');
      return;
    }

    const badges = getBadges(user.id, ctx.client);
    const hasVoted = await new UserDbService().userVotedToday(user.id, userData);
    if (hasVoted) badges.push(getVoterBadge(ctx.client));

    const embed = new EmbedBuilder()
      .setDescription(`### @${user.username} ${formatBadges(badges)}`)
      .addFields([
        {
          name: 'Badges',
          value: badges.map((b) => `${b.emoji} ${b.name} - ${b.description}`).join('\n') || 'No badges',
          inline: false,
        },
        {
          name: 'Leaderboard Rank',
          value: `#${(await getUserLeaderboardRank(user.id)) ?? 'Unranked.'}`,
          inline: true,
        },
        {
          name: 'Total Messages',
          value: `${userData.messageCount}`,
          inline: true,
        },
        {
          name: 'User Since',
          value: `${time(Math.round(userData.createdAt.getTime() / 1000), 'D')}`,
          inline: true,
        },
        {
          name: 'Hubs Owned',
          value: `${(await db.hub.findMany({ where: { ownerId: user.id, private: false } })).map((h) => h.name).join(', ')}`,
          inline: true,
        },
        {
          name: 'User ID',
          value: user.id,
          inline: true,
        },
      ])
      .setColor(Constants.Colors.invisible)
      .setThumbnail(user.displayAvatarURL());

    await ctx.reply({ embeds: [embed] });
  }
}
