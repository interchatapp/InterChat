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
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { donateButton } from '#src/utils/ComponentUtils.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Constants from '#utils/Constants.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { getCredits } from '#utils/Utils.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type Client,
} from 'discord.js';

export default class About extends BaseCommand {
  constructor() {
    super({
      name: 'about',
      description: '🚀 Learn how InterChat helps grow Discord communities',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context) {
    const creditsEmbed = new InfoEmbed()
      .setDescription(
        stripIndents`
        ### ${ctx.getEmoji('wand_icon')} About InterChat
        InterChat connects Discord communities through active cross-server discussions. Messages flow naturally between servers in real-time, helping you build engaged topic-focused communities.

        ### What makes InterChat different:
        - Built for real communities - Designed with Discord server owners' needs in mind
        - Active hubs - Find and join thriving communities around shared interests
        - Privacy first - Full control over your hub's connections and settings
        - Smart moderation - AI-powered image filtering and advanced content filtering keeps discussions healthy
        `,
      )
      .setFooter({
        text: ` InterChat v${ctx.client.version} • Made with ❤️ by the InterChat Team`,
      });

    const linkButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Invite')
        .setEmoji(ctx.getEmoji('plus_icon'))
        .setURL('https://discord.com/application-directory/769921109209907241'),
      donateButton,
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Support')
        .setEmoji(ctx.getEmoji('code_icon'))
        .setURL(Constants.Links.SupportInvite),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Vote!')
        .setEmoji(ctx.getEmoji('topggSparkles'))
        .setURL('https://top.gg/bot/769921109209907241/vote'),
    );

    const normalButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID('about:credits').toString())
        .setStyle(ButtonStyle.Primary)
        .setLabel('Credits & Team')
        .setEmoji(`${ctx.getEmoji('ghost_heart')}`),
    );

    await ctx.reply({
      embeds: [creditsEmbed],
      components: [linkButtons, normalButtons],
    });
  }

  @RegisterInteractionHandler('about', 'credits')
  public async handleCreditsButton(interaction: ButtonInteraction) {
    await interaction.deferReply({ flags: ['Ephemeral'] });

    const usernames = await this.getUsernames(interaction.client);
    const creditsDivider = `${getEmoji('blueLine', interaction.client).repeat(9)} **CREDITS** ${getEmoji('blueLine', interaction.client).repeat(9)}`;
    const dotBlue = getEmoji('dot', interaction.client);

    const creditsEmbed = new InfoEmbed()
      .setDescription(
        stripIndents`
      
        ${creditsDivider}
        ${getEmoji('BadgeDeveloper', interaction.client)} **Developers:**
        ${dotBlue} @${usernames[0]}

        ${getEmoji('BadgeStaff', interaction.client)} **Staff: ([Check Applications!](${Constants.Links.Website}/apply))**
        ${dotBlue} @${usernames[1]}
        ${dotBlue} @${usernames[2]}
        ${dotBlue} @${usernames[3]}

        ✨ **Deserving Mentions:**
        ${dotBlue} @${usernames[4]} (maker of our cute mascot chipi ${getEmoji('chipi_smile', interaction.client)})
        ${dotBlue} @${usernames[5]} ([top voter](${Constants.Links.Vote}) of all time ${getEmoji('topggSparkles', interaction.client)})
        ${creditsDivider}
      `,
      )
      .setFooter({
        text: ` InterChat v${interaction.client.version} • Made with ❤️ by the InterChat Team`,
      });

    await interaction.editReply({ embeds: [creditsEmbed] });
  }

  private async getUsernames(client: Client): Promise<string[]> {
    const members: string[] = [];

    for (const credit of getCredits()) {
      const member = await client.users.fetch(credit);
      members.push(member.username.replaceAll('_', '\\_'));
    }

    return members;
  }
}
