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
import { HubService } from '#src/services/HubService.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { escapeRegexChars, fetchUserLocale } from '#src/utils/Utils.js';
import Constants from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import { supportedLocaleCodes, t } from '#utils/Locale.js';
import {
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
} from 'discord.js';

export default class Rules extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'rules',
      description: '📋 Sends the network rules for InterChat.',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'hub',
          description: 'View rules for a specific hub',
          required: false,
          autocomplete: true,
        },
      ],
    });
  }

  async execute(ctx: Context) {
    const locale = await ctx.getLocale();
    const hubName = ctx.options.getString('hub');

    // If a hub is specified, show hub rules
    if (hubName) {
      return this.showHubRules(ctx, hubName, locale);
    }

    // Otherwise show general network rules using Components v2
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader(t('rules.header', locale), t('rules.botRulesNote', locale, {}), 'rules_icon'),
    );

    // Add separator
    ui.addSeparator(container);

    // Add rules content
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        t('rules.rules', locale, {
          guidelines_link: `${Constants.Links.Website}/guidelines`,
        }),
      ),
    );

    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Show rules for a specific hub
   */
  private async showHubRules(ctx: Context, hubName: string, locale: supportedLocaleCodes) {
    await ctx.deferReply();

    // Fetch the hub
    const hub = await this.hubService.fetchHub({ name: hubName });
    if (!hub) {
      await ctx.editReply({
        content: t('hub.notFound', locale, {
          emoji: ctx.getEmoji('x_icon'),
        }),
      });
      return;
    }

    // Get the hub rules
    const rules = hub.getRules();

    // Create UI components
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header with hub name and icon
    container.addTextDisplayComponents(
      ui.createHeader(`${hubName} Rules`, 'The following rules apply to this hub', 'rules_icon'),
    );

    // Add separator
    ui.addSeparator(container);

    // If no rules, show a message
    if (!rules.length) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          t('hub.rules.noRules', locale, {
            emoji: getEmoji('info_icon', ctx.client),
          }),
        ),
      );
    }
    else {
      // Format the rules list
      const rulesList = rules.map((rule, index) => `**${index + 1}.** ${rule}`).join('\n\n');
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          t('hub.rules.list', locale, {
            emoji: getEmoji('rules_icon', ctx.client),
            rules: rulesList,
          }),
        ),
      );
    }

    // Add back to network rules button
    const botRulesButton = new ButtonBuilder()
      .setCustomId(new CustomID().setIdentifier('rules', 'bot').toString())
      .setLabel(t('rules.viewbotRules', locale, {}))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('rules_icon', ctx.client));

    // Add button section
    const buttonSection = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t('rules.botRulesNote', locale, {})),
      )
      .setButtonAccessory(botRulesButton);

    container.addSectionComponents(buttonSection);

    // Send the response
    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Handle autocomplete for hub selection
   */
  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focusedValue = escapeRegexChars(interaction.options.getFocused());

    // Find public hubs matching the search term
    const hubChoices = await this.hubService.findHubsByName(focusedValue, {
      take: 25,
      insensitive: true,
      searchType: 'contains',
    });

    await interaction.respond(
      hubChoices.map((hub) => ({
        name: hub.data.name,
        value: hub.data.name,
      })),
    );
  }

  @RegisterInteractionHandler('rules', 'bot')
  async handlebotRulesButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const locale = await fetchUserLocale(ctx.user.id);
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader('InterChat Rules', 'Bot-wide rules for all users', 'rules_icon'),
    );

    // Add separator
    ui.addSeparator(container);

    // Add rules content
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        t('rules.rules', locale, { guidelines_link: `${Constants.Links.Website}/guidelines` }),
      ),
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }
}
