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
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

export default class Donate extends BaseCommand {
  private donationManager = new DonationManager();

  constructor() {
    super({
      name: 'donate',
      description: 'Support InterChat development with a donation and unlock donor perks!',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context) {
    const { id } = ctx.user;

    // Get user's donation stats
    const totalDonated = await this.donationManager.getUserTotalDonated(id);
    const donationCount = await this.donationManager.getUserDonationCount(id);
    const isDonor = await this.donationManager.isUserDonor(id);

    const donorStatusEmoji = ctx.getEmoji(isDonor ? 'tick_icon' : 'slash');

    const donateEmbed = new EmbedBuilder()
      .setAuthor({
        name: '☕ Support InterChat Development',
        iconURL: 'https://i.imgur.com/NKKmav5.gif',
      })
      .setDescription(
        stripIndents`
          Help keep InterChat free and improving! Your donations directly support:

          🔧 **Server costs & infrastructure**
          ⚡ **Performance improvements**
          ✨ **New features & updates**
          🛠️ **Bug fixes & maintenance**
          🌍 **Community support**

          Every contribution, no matter the size, makes a difference! ❤️
        `,
      )
      .setFields(
        {
          name: '💰 Your Donation Stats',
          value: stripIndents`
            **Total Donated:** $${totalDonated.toFixed(2)} USD
            **Donations Made:** ${donationCount}
            **Donor Status:** ${isDonor ? '✅ Active Donor' : '❌ Not a Donor'}
          `,
          inline: true,
        },
        {
          name: '🎁 Donor Perks',
          value: stripIndents`
            ${donorStatusEmoji} Special donor badge in profile & messages
            ${donorStatusEmoji} Donor role in support server
            ${donorStatusEmoji} Send Stickers, GIFs & Images in calls
            ${donorStatusEmoji} Increased limits on hub creation
            ${donorStatusEmoji} Change hub name
            ${donorStatusEmoji} Early access to new features
            ${donorStatusEmoji} Recognition in donor leaderboard
            -# More perks coming soon! Join our [support server](${Constants.Links.SupportInvite}) for updates.
          `,
        },
      )
      .setColor(isDonor ? '#FF5722' : Constants.Colors.invisible)
      .setFooter({
        text: 'InterChat - Donation Support',
        iconURL: 'https://i.imgur.com/NKKmav5.gif',
      });

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Donate on Ko-fi')
        .setEmoji('☕')
        .setURL(Constants.Links.Donate),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Donor Leaderboard')
        .setEmoji('🏆')
        .setURL(`${Constants.Links.Website}/donors`),
    );

    await ctx.reply({ embeds: [donateEmbed], components: [buttons] });
  }
}
