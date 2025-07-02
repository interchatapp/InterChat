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
import { DonationManager } from '#src/lib/donations/core/DonationManager.js';
import Constants from '#utils/Constants.js';
import db from '#utils/Db.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  userMention,
} from 'discord.js';

export default class Donors extends BaseCommand {
  private donationManager = new DonationManager();

  constructor() {
    super({
      name: 'donors',
      description: 'View the top donors who support InterChat development!',
      types: { slash: true, prefix: true },
      aliases: ['donorboard', 'topdonors'],
    });
  }

  async execute(ctx: Context) {
    // Get top donors by total donated amount
    const topDonors = await db.user.findMany({
      where: {
        isDonor: true,
        totalDonated: { gt: 0 },
      },
      orderBy: {
        totalDonated: 'desc',
      },
      take: 10,
      select: {
        id: true,
        name: true,
        totalDonated: true,
        donationCount: true,
        lastDonatedAt: true,
      },
    });

    // Get total donation stats
    const totalStats = await db.user.aggregate({
      where: { isDonor: true },
      _sum: { totalDonated: true, donationCount: true },
      _count: { id: true },
    });

    const totalAmount = totalStats._sum.totalDonated || 0;
    const totalDonations = totalStats._sum.donationCount || 0;
    const totalDonors = totalStats._count || 0;

    // Get current user's rank
    const currentUserRank = await this.getUserDonorRank(ctx.user.id);

    let leaderboardText = '';
    if (topDonors.length === 0) {
      leaderboardText = 'No donors yet! Be the first to support InterChat! ☕';
    }
    else {
      leaderboardText = topDonors
        .map((donor, index) => {
          const rank = index + 1;
          const medal = this.getRankMedal(rank);
          const username = donor.name || 'Unknown User';
          const amount = donor.totalDonated.toFixed(2);
          const donations = donor.donationCount;

          return (
            `${medal} **${rank}.** ${userMention(donor.id)} (**${username}**)\n` +
            `   💰 $${amount} USD • 🎁 ${donations} donation${donations !== 1 ? 's' : ''}`
          );
        })
        .join('\n\n');
    }

    const donorsEmbed = new EmbedBuilder()
      .setAuthor({
        name: '🏆 InterChat Donor Leaderboard',
        iconURL: 'https://i.imgur.com/NKKmav5.gif',
      })
      .setDescription(
        stripIndents`
          Thank you to all our amazing donors who keep InterChat running! ❤️

          ${leaderboardText}
        `,
      )
      .setFields(
        {
          name: '📊 Community Stats',
          value: stripIndents`
            **Total Donors:** ${totalDonors.id.toString()}
            **Total Donated:** $${totalAmount.toFixed(2)} USD
            **Total Donations:** ${totalDonations.toString()}
          `,
          inline: true,
        },
        {
          name: '🎯 Your Rank',
          value:
            currentUserRank > 0
              ? `You're ranked #${currentUserRank} among donors!`
              : 'Not ranked yet - make your first donation!',
          inline: true,
        },
      )
      .setColor('#FF5722')
      .setFooter({
        text: 'InterChat - Donor Leaderboard • Updates every hour',
        iconURL: 'https://i.imgur.com/NKKmav5.gif',
      })
      .setTimestamp();

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Become a Donor')
        .setEmoji('☕')
        .setURL(Constants.Links.Donate),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Secondary)
        .setCustomId('refresh_donors')
        .setLabel('Refresh')
        .setEmoji('🔄'),
    );

    await ctx.reply({ embeds: [donorsEmbed], components: [buttons] });
  }

  /**
   * Get medal emoji for rank
   */
  private getRankMedal(rank: number): string {
    switch (rank) {
      case 1:
        return '🥇';
      case 2:
        return '🥈';
      case 3:
        return '🥉';
      default:
        return '🏅';
    }
  }

  /**
   * Get user's donor rank
   */
  private async getUserDonorRank(userId: string): Promise<number> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { totalDonated: true, isDonor: true },
    });

    if (!user?.isDonor || !user.totalDonated || user.totalDonated <= 0) {
      return 0;
    }

    const rank = await db.user.count({
      where: {
        isDonor: true,
        totalDonated: { gt: user.totalDonated },
      },
    });

    return rank + 1;
  }
}
