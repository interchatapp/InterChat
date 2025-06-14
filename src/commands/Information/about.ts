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
import { fetchUserLocale } from '#src/utils/Utils.js';
import { t } from '#src/utils/Locale.js';
import Constants from '#utils/Constants.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { getCreditsByType } from '#utils/Utils.js';
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
    const locale = await fetchUserLocale(ctx.user.id);
    const container = new ContainerBuilder();

    const text1 = new TextDisplayBuilder().setContent(
      stripIndents`
      # ${ctx.getEmoji('wand_icon')} ${t('commands.about.title', locale)}
      ${t('commands.about.description_text', locale)}
      ## ${t('commands.about.features.title', locale)}
      ${t('commands.about.features.list', locale)}
      `,
    );

    container.addTextDisplayComponents(text1);

    const inviteButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(t('commands.about.buttons.invite', locale))
      .setEmoji(ctx.getEmoji('plus_icon'))
      .setURL('https://discord.com/application-directory/769921109209907241');

    const dashboardButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(t('commands.about.buttons.dashboard', locale))
      .setEmoji(ctx.getEmoji('wand_icon'))
      .setURL(`${Constants.Links.Website}/dashboard`);

    const supportButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(t('commands.about.buttons.support', locale))
      .setEmoji(ctx.getEmoji('code_icon'))
      .setURL(Constants.Links.SupportInvite);

    const sectionInvite = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t('commands.about.sections.invite', locale)),
      )
      .setButtonAccessory(inviteButton);
    const sectionDashboard = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t('commands.about.sections.dashboard', locale)),
      )
      .setButtonAccessory(dashboardButton);
    const sectionSupport = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t('commands.about.sections.support', locale)),
      )
      .setButtonAccessory(supportButton);

    container
      .addSectionComponents(sectionInvite, sectionDashboard, sectionSupport)
      .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Large));

    const creditsSection = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t('commands.about.sections.credits', locale)),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(new CustomID('about:credits').toString())
          .setStyle(ButtonStyle.Primary)
          .setLabel(t('commands.about.buttons.credits', locale))
          .setEmoji(`${ctx.getEmoji('ghost_heart')}`),
      );

    container
      .addSectionComponents(creditsSection)
      .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Large));

    const text4 = new TextDisplayBuilder().setContent(t('commands.about.support_text', locale));

    const voteButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(t('commands.about.buttons.vote', locale))
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

    const locale = await fetchUserLocale(ctx.user.id);
    const creditsByType = await this.getUsernamesByType(ctx.client);
    const creditsDivider = `${getEmoji('blueLine', ctx.client).repeat(9)} **${t('commands.about.credits.title', locale)}** ${getEmoji('blueLine', ctx.client).repeat(9)}`;
    const dotBlue = getEmoji('dot', ctx.client);

    // Build credits sections dynamically
    const creditsContent: string[] = [creditsDivider];

    // Developers section
    if (creditsByType.developers.length > 0) {
      creditsContent.push(
        `${getEmoji('developer_badge', ctx.client)} **${t('commands.about.credits.developers', locale)}**`,
        ...creditsByType.developers.map((username) => `${dotBlue} @${username}`),
        '',
      );
    }

    // Staff section
    if (creditsByType.staff.length > 0) {
      creditsContent.push(
        `${getEmoji('staff_badge', ctx.client)} **${t('commands.about.credits.staff', locale, { website: Constants.Links.Website })}**`,
        ...creditsByType.staff.map((username) => `${dotBlue} @${username}`),
        '',
      );
    }

    // Translators section
    if (creditsByType.translators.length > 0) {
      creditsContent.push(
        `${getEmoji('translator_badge', ctx.client)} **${t('commands.about.credits.translators', locale)}**`,
        ...creditsByType.translators.map((username) => `${dotBlue} @${username}`),
        '',
      );
    }

    // Special mentions section (supporters)
    if (creditsByType.supporters.length > 0) {
      creditsContent.push(
        `✨ **${t('commands.about.credits.mentions', locale)}**`,
        ...creditsByType.supporters.map((username, index) => {
          // First supporter gets mascot mention, second gets top voter mention
          if (index === 0) {
            return `${dotBlue} @${username} ${t('commands.about.credits.mascot', locale, { emoji: getEmoji('chipi_smile', ctx.client) })}`;
          }
          else if (index === 1) {
            return `${dotBlue} @${username} ${t('commands.about.credits.top_voter', locale, { vote_url: Constants.Links.Vote, emoji: getEmoji('topggSparkles', ctx.client) })}`;
          }
          return `${dotBlue} @${username}`;
        }),
        '',
      );
    }

    creditsContent.push(creditsDivider);

    const creditsEmbed = new InfoEmbed()
      .setDescription(creditsContent.join('\n'))
      .setFooter({
        text: t('commands.about.credits.footer', locale, { version: ctx.client.version }),
      });

    await ctx.editReply({ embeds: [creditsEmbed] });
  }

  private async getUsernamesByType(client: Client): Promise<{
    developers: string[];
    staff: string[];
    translators: string[];
    supporters: string[];
  }> {
    const creditsByType = getCreditsByType();
    const result = {
      developers: [] as string[],
      staff: [] as string[],
      translators: [] as string[],
      supporters: [] as string[],
    };

    // Fetch usernames for each type
    for (const [type, userIds] of Object.entries(creditsByType)) {
      const usernames: string[] = [];
      for (const userId of userIds) {
        try {
          const user = await client.users.fetch(userId);
          usernames.push(user.username.replaceAll('_', '\\_'));
        }
        catch {
          // If user fetch fails, skip this user but continue with others
          // This can happen if a user account is deleted or inaccessible
        }
      }
      result[type as keyof typeof result] = usernames;
    }

    return result;
  }
}
