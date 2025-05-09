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
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { donateButton } from '#src/utils/ComponentUtils.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Constants from '#utils/Constants.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { getCredits } from '#utils/Utils.js';
import { stripIndents } from 'common-tags';
import {
  ButtonBuilder,
  ButtonStyle,
  type Client,
  ContainerBuilder,
  SectionBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
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
    const container = new ContainerBuilder();

    const text1 = new TextDisplayBuilder().setContent(
      stripIndents`
      # ${ctx.getEmoji('wand_icon')} About InterChat
      InterChat connects Discord communities through active cross-server discussions. Messages flow naturally between servers in real-time, helping you build engaged topic-focused communities.
      ## What makes InterChat different:
      - Built for real communities - Designed with Discord server owners' needs in mind
      - Active hubs - Find and join thriving communities around shared interests
      - Privacy first - Full control over your hub's connections and settings
      - Smart moderation - AI-powered image filtering and advanced content filtering keeps discussions healthy
      - Visual dashboard - Manage your hubs, servers, and settings through our web interface
      `,
    );

    container.addTextDisplayComponents(text1);

    const inviteButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Invite')
      .setEmoji(ctx.getEmoji('plus_icon'))
      .setURL('https://discord.com/application-directory/769921109209907241');

    const dashboardButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Dashboard')
      .setEmoji(ctx.getEmoji('wand_icon'))
      .setURL(`${Constants.Links.Website}/dashboard`);

    const supportButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Support Server')
      .setEmoji(ctx.getEmoji('code_icon'))
      .setURL(Constants.Links.SupportInvite);


    const sectionInvite = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('Invite InterChat to your server:'),
      )
      .setButtonAccessory(inviteButton);
    const sectionDashboard = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('Visit the InterChat dashboard:'),
      )
      .setButtonAccessory(dashboardButton);
    const sectionSupport = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('Join our support server:'))
      .setButtonAccessory(supportButton);

    container
      .addSectionComponents(sectionInvite, sectionDashboard, sectionSupport)
      .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Large));

    const creditsSection = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('Check out the InterChat team!'),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(new CustomID('about:credits').toString())
          .setStyle(ButtonStyle.Primary)
          .setLabel('Credits & Team')
          .setEmoji(`${ctx.getEmoji('ghost_heart')}`),
      );

    container
      .addSectionComponents(creditsSection)
      .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Large));

    const text4 = new TextDisplayBuilder().setContent(
      'InterChat is completely free to use. If you like InterChat, consider supporting us on Ko-fi! Or even a vote on top.gg helps us a lot!',
    );

    const voteButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Vote!')
      .setEmoji(ctx.getEmoji('topggSparkles'))
      .setURL('https://top.gg/bot/769921109209907241/vote');

    container
      .addTextDisplayComponents(text4)
      .addActionRowComponents((row) => row.addComponents(donateButton, voteButton));

    await ctx.reply({ components: [container], flags: ['IsComponentsV2'] });
  }

  @RegisterInteractionHandler('about', 'credits')
  public async handleCreditsButton(ctx: ComponentContext) {
    await ctx.deferReply({ flags: ['Ephemeral'] });

    const usernames = await this.getUsernames(ctx.client);
    const creditsDivider = `${getEmoji('blueLine', ctx.client).repeat(9)} **CREDITS** ${getEmoji('blueLine', ctx.client).repeat(9)}`;
    const dotBlue = getEmoji('dot', ctx.client);

    const creditsEmbed = new InfoEmbed()
      .setDescription(
        stripIndents`

        ${creditsDivider}
        ${getEmoji('developer_badge', ctx.client)} **Developers:**
        ${dotBlue} @${usernames[0]}

        ${getEmoji('staff_badge', ctx.client)} **Staff: ([Check Applications!](${Constants.Links.Website}/apply))**
        ${dotBlue} @${usernames[1]}
        ${dotBlue} @${usernames[2]}
        ${dotBlue} @${usernames[3]}
        ${dotBlue} @${usernames[4]}

        ${getEmoji('translator_badge', ctx.client)} **Translators:**
        ${dotBlue} @${usernames[5]}
        ${dotBlue} @${usernames[6]}
        ${dotBlue} @${usernames[7]}

        ✨ **Deserving Mentions:**
        ${dotBlue} @${usernames[8]} (maker of our cute mascot chipi ${getEmoji('chipi_smile', ctx.client)})
        ${dotBlue} @${usernames[9]} ([top voter](${Constants.Links.Vote}) of all time ${getEmoji('topggSparkles', ctx.client)})
        ${creditsDivider}
      `,
      )
      .setFooter({
        text: ` InterChat v${ctx.client.version} • Made with ❤️ by the InterChat Team`,
      });

    await ctx.editReply({ embeds: [creditsEmbed] });
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
