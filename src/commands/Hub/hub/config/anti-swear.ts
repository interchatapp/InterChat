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

import HubCommand, { hubOption } from '#src/commands/Hub/hub/index.js';
import BaseCommand from '#src/core/BaseCommand.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import type Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { BlockWordAction, type AntiSwearRule } from '#src/generated/prisma/client/client.js';
import AntiSwearManager from '#src/managers/AntiSwearManager.js';
import Logger from '#src/utils/Logger.js';
import { HubService } from '#src/services/HubService.js';
import { numberEmojis } from '#src/utils/Constants.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { runHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { supportedLocaleCodes, t } from '#src/utils/Locale.js';
import { ACTION_LABELS, sanitizeWords } from '#src/utils/moderation/antiSwear.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
} from 'discord.js';

const CUSTOM_ID_PREFIX = 'antiSwear' as const;

export default class HubConfigAntiSwearSubcommand extends BaseCommand {
  private readonly hubService = new HubService();
  private readonly MAX_RULES = 5; // Increased from 2 in the old system

  constructor() {
    super({
      name: 'anti-swear',
      description: '🤬 Configure anti-swear rules for the hub (improved system).',
      types: { slash: true, prefix: true },
      options: [hubOption],
    });
  }

  public async execute(ctx: Context) {
    await ctx.deferReply();

    const hubName = ctx.options.getString('hub') ?? undefined;
    const hub = await this.hubService.fetchHub({ name: hubName });
    if (!hub || !(await runHubRoleChecksAndReply(hub, ctx, { checkIfManager: true }))) {
      return;
    }

    const locale = await ctx.getLocale();
    const antiSwearRules = await hub.fetchAntiSwearRules();

    const container = this.buildRulesContainer(antiSwearRules, hub.id, locale, ctx.client);

    await ctx.editOrReply(
      {
        components: [container],
      },
      ['IsComponentsV2'],
    );
  }

  /**
   * Builds a Components v2 container for the anti-swear rules list
   */
  private buildRulesContainer(
    rules: AntiSwearRule[],
    hubId: string,
    locale: supportedLocaleCodes,
    client: Client,
  ): ContainerBuilder {
    const container = new ContainerBuilder();

    // Header section
    const headerText = new TextDisplayBuilder().setContent(
      t('hub.blockwords.listDescription', locale, {
        totalRules: rules.length.toString(),
        emoji: getEmoji('alert_icon', client),
      }),
    );

    container.addTextDisplayComponents(headerText);

    // If there are no rules, show a message
    if (rules.length === 0) {
      const noRulesText = new TextDisplayBuilder().setContent(
        t('hub.blockwords.noRules', locale, {
          emoji: getEmoji('slash_icon', client),
        }),
      );
      container.addTextDisplayComponents(noRulesText);
    }
    else {
      // Add each rule as a section
      rules.forEach((rule, index) => {
        const actionsList =
          rule.actions.length > 0 ? rule.actions.map((a) => ACTION_LABELS[a]).join(', ') : 'None';

        const ruleSection = new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `### ${numberEmojis[index + 1]} ${rule.name}\n**Actions:** ${actionsList}`,
            ),
          )
          .setButtonAccessory(
            new ButtonBuilder()
              .setCustomId(
                new CustomID()
                  .setIdentifier(CUSTOM_ID_PREFIX, 'select-rule')
                  .setArgs(hubId, rule.id)
                  .toString(),
              )
              .setLabel('Edit Rule')
              .setStyle(ButtonStyle.Secondary),
          );

        container.addSectionComponents(ruleSection);
      });

      // Add separator
      container.addSeparatorComponents((separator) =>
        separator.setSpacing(SeparatorSpacingSize.Large),
      );
    }

    // Add button to create a new rule
    const addRuleButton = new ButtonBuilder()
      .setCustomId(
        new CustomID().setIdentifier(CUSTOM_ID_PREFIX, 'add-rule').setArgs(hubId).toString(),
      )
      .setLabel('Add Rule')
      .setStyle(ButtonStyle.Success);

    container.addActionRowComponents((row) => row.addComponents(addRuleButton));

    return container;
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const hubs = await HubCommand.getModeratedHubs(
      interaction.options.getFocused(),
      interaction.user.id,
      this.hubService,
    );

    await interaction.respond(hubs.map(({ data }) => ({ name: data.name, value: data.name })));
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'select-rule')
  async handleRuleSelection(ctx: ComponentContext) {
    const [hubId, ruleId] = ctx.customId.args;

    // If this is a select menu ctx, get the selected rule ID from values
    const selectedRuleId = ctx.values ? ctx.values[0] : ruleId;

    const { rule } = await this.getHubAndRule(hubId, selectedRuleId, ctx);
    if (!rule) return;

    const locale = await fetchUserLocale(ctx.user.id);
    const ruleWithPatterns = this.ensureRuleHasPatterns(rule);
    const container = this.buildRuleDetailContainer(ruleWithPatterns!, hubId, locale, ctx.client);

    await ctx.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  /**
   * Builds a Components v2 container for a specific rule's details
   */
  private buildRuleDetailContainer(
    rule: AntiSwearRule & { patterns: { pattern: string; isRegex: boolean }[] },
    hubId: string,
    locale: supportedLocaleCodes,
    client: Client,
  ): ContainerBuilder {
    const container = new ContainerBuilder();

    // Format patterns for display
    const patterns = rule.patterns.map((p) => p.pattern).join(', ');

    // Rule details section
    const actionsList =
      rule.actions.length > 0
        ? rule.actions.map((a) => ACTION_LABELS[a]).join(', ')
        : t('hub.blockwords.embedFields.noActions', locale, {
          emoji: getEmoji('x_icon', client),
        });

    const ruleDetailsText = new TextDisplayBuilder().setContent(
      `# ${getEmoji('alert_icon', client)} ${rule.name}\n${t(
        'hub.blockwords.ruleDescription',
        locale,
        {
          emoji: getEmoji('alert_icon', client),
          ruleName: rule.name,
          words: patterns ? `\`\`\`\n${patterns}\n\`\`\`` : '',
        },
      )}## ${t('hub.blockwords.embedFields.actionsName', locale)}\n${actionsList}`,
    );

    container.addTextDisplayComponents(ruleDetailsText);

    // Actions select menu
    const actionsSelect = this.buildAntiSwearActionsSelect(hubId, rule.id, rule.actions, locale);
    container.addActionRowComponents((row) => row.addComponents(actionsSelect.components[0]));

    // Buttons for navigation and actions
    const backButton = new ButtonBuilder()
      .setCustomId(new CustomID().setIdentifier(CUSTOM_ID_PREFIX, 'home').setArgs(hubId).toString())
      .setEmoji(getEmoji('back', client))
      .setStyle(ButtonStyle.Secondary);

    const editButton = new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier(CUSTOM_ID_PREFIX, 'editRule')
          .setArgs(hubId, rule.id)
          .toString(),
      )
      .setLabel('Edit Rule')
      .setStyle(ButtonStyle.Secondary);

    const deleteButton = new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier(CUSTOM_ID_PREFIX, 'del-rule')
          .setArgs(hubId, rule.id)
          .toString(),
      )
      .setEmoji(getEmoji('deleteDanger_icon', client))
      .setLabel('Delete Rule')
      .setStyle(ButtonStyle.Danger);

    container.addActionRowComponents((row) =>
      row.addComponents(backButton, editButton, deleteButton),
    );

    return container;
  }

  private buildAntiSwearActionsSelect(
    hubId: string,
    ruleId: string,
    currentActions: BlockWordAction[],
    locale: supportedLocaleCodes,
  ) {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier(CUSTOM_ID_PREFIX, 'actions')
            .setArgs(hubId, ruleId)
            .toString(),
        )
        .setPlaceholder(t('hub.blockwords.actionSelectPlaceholder', locale))
        .setMinValues(1)
        .setMaxValues(Object.keys(BlockWordAction).length)
        .setOptions(
          Object.entries(ACTION_LABELS).map(([value, label]) => ({
            label,
            value,
            default: currentActions.includes(value as BlockWordAction),
          })),
        ),
    );
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'del-rule')
  async handleDeleteRule(ctx: ComponentContext) {
    await ctx.deferReply();

    const [hubId, ruleId] = ctx.customId.args;

    const { hub, rule } = await this.getHubAndRule(hubId, ruleId, ctx);
    if (!rule) return;

    await hub.deleteAntiSwearRule(ruleId);

    // Invalidate cache
    AntiSwearManager.getInstance().invalidateCache(hubId);

    const locale = await fetchUserLocale(ctx.user.id);
    await ctx.editReply(
      t('hub.blockwords.deleted', locale, {
        emoji: getEmoji('tick_icon', ctx.client),
      }),
    );
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'add-rule')
  async handleCreateRule(ctx: ComponentContext) {
    const [hubId] = ctx.customId.args;

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub || !(await runHubRoleChecksAndReply(hub, ctx, { checkIfManager: true }))) {
      return;
    }

    const locale = await fetchUserLocale(ctx.user.id);
    const modal = this.buildAntiSwearModal(hubId, locale);
    await ctx.showModal(modal);
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'editRule')
  async handleEditButtons(ctx: ComponentContext) {
    const [hubId, ruleId] = ctx.customId.args;

    const { rule } = await this.getHubAndRule(hubId, ruleId, ctx);
    if (!rule) return;

    const locale = await fetchUserLocale(ctx.user.id);
    const ruleWithPatterns = this.ensureRuleHasPatterns(rule);
    const modal = this.buildAntiSwearModal(hubId, locale, ruleWithPatterns!);
    await ctx.showModal(modal);
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'home')
  async handleHomeButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [hubId] = ctx.customId.args;

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) return;

    const antiSwearRules = await hub.fetchAntiSwearRules();
    const locale = await fetchUserLocale(ctx.user.id);

    const container = this.buildRulesContainer(antiSwearRules, hub.id, locale, ctx.client);

    await ctx.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'modal')
  async handleModals(ctx: ComponentContext) {
    await ctx.deferUpdate();

    if (!ctx.isModalSubmit()) return;

    const [hubId, ruleId] = ctx.customId.args;
    Logger.debug(`Anti-swear modal submission - hubId: ${hubId}, ruleId: ${ruleId}`);

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) return;

    const locale = await fetchUserLocale(ctx.user.id);

    const name = ctx.getModalFieldValue('name');
    const wordsInput = ctx.getModalFieldValue('words');
    const patterns = wordsInput
      .split(',')
      .map((w) => sanitizeWords(w.trim()))
      .filter((w) => w);

    let rule;

    // new rule
    if (!ruleId) {
      if ((await hub.fetchAntiSwearRules()).length >= this.MAX_RULES) {
        await ctx.reply({
          content: t('hub.blockwords.maxRules', locale, {
            emoji: getEmoji('x_icon', ctx.client),
          }),
          flags: ['Ephemeral'],
        });
        return;
      }

      rule = await hub.createAntiSwearRule({
        name,
        createdBy: ctx.user.id,
        patterns,
        actions: [] as BlockWordAction[],
      });
    }
    else {
      Logger.debug(`Updating anti-swear rule - hubId: ${hubId}, ruleId: ${ruleId}`);
      rule = await hub.updateAntiSwearRule(ruleId, {
        name,
        patterns,
      });
    }

    const ruleWithPatterns = this.ensureRuleHasPatterns(rule);
    const container = this.buildRuleDetailContainer(ruleWithPatterns!, hubId, locale, ctx.client);

    await ctx.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'actions')
  async handleActionSelection(ctx: ComponentContext) {
    if (!ctx.isStringSelectMenu()) return;

    const [hubId, ruleId] = ctx.customId.args;
    const selectedActions = ctx.values as BlockWordAction[];

    const { hub, rule } = await this.getHubAndRule(hubId, ruleId, ctx);
    if (!rule) return;

    await hub.updateAntiSwearRule(ruleId, { actions: selectedActions });

    // Invalidate cache
    AntiSwearManager.getInstance().invalidateCache(hubId);

    const actionLabels = selectedActions.map((action) => ACTION_LABELS[action]).join(', ');

    await ctx.reply({
      content: t('hub.blockwords.actionsUpdated', await fetchUserLocale(ctx.user.id), {
        emoji: getEmoji('tick_icon', ctx.client),
        actions: actionLabels,
      }),
      flags: ['Ephemeral'],
    });
  }

  private buildAntiSwearModal(
    hubId: string,
    locale: supportedLocaleCodes,
    presetRule?: AntiSwearRule & { patterns: { pattern: string; isRegex: boolean }[] },
  ) {
    // Initialize without any args
    const customId = new CustomID().setIdentifier(CUSTOM_ID_PREFIX, 'modal');

    // Then set the appropriate args based on whether we're editing or creating
    if (presetRule) {
      customId.setArgs(hubId, presetRule.id);
    }
    else {
      customId.setArgs(hubId);
    }

    const modal = new ModalBuilder()
      .setTitle(
        presetRule
          ? t('hub.blockwords.modal.editingRule', locale)
          : t('hub.blockwords.modal.addRule', locale),
      )
      .setCustomId(customId.toString())
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('name')
            .setStyle(TextInputStyle.Short)
            .setLabel(t('hub.blockwords.modal.ruleNameLabel', locale))
            // .setMinLength(3)
            .setMaxLength(40)
            .setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('words')
            .setStyle(TextInputStyle.Paragraph)
            .setLabel(t('hub.blockwords.modal.wordsLabel', locale))
            .setPlaceholder(t('hub.blockwords.modal.wordsPlaceholder', locale))
            .setMinLength(3)
            .setRequired(true),
        ),
      );

    if (presetRule) {
      modal.components[0].components[0].setValue(presetRule.name);

      // Get patterns and ensure they meet the minimum length requirement
      let patterns = presetRule.patterns.map((p) => p.pattern).join(', ');

      // If patterns string is too short, pad it to meet the minimum length
      if (patterns.length < 3) {
        Logger.warn(
          `Anti-swear rule "${presetRule.name}" has patterns string less than 3 characters: "${patterns}"`,
        );
        // Add placeholder text to meet the minimum length requirement
        patterns = patterns || 'example-word';
      }

      modal.components[1].components[0].setValue(patterns);
    }

    return modal;
  }

  // Helper method to ensure a rule has patterns property
  private ensureRuleHasPatterns(
    rule: AntiSwearRule | null,
  ): (AntiSwearRule & { patterns: { pattern: string; isRegex: boolean }[] }) | null {
    if (!rule) return null;

    // If patterns is already defined, return as is
    if (
      'patterns' in rule &&
      Array.isArray((rule as unknown as { patterns: unknown[] }).patterns)
    ) {
      return rule as AntiSwearRule & { patterns: { pattern: string; isRegex: boolean }[] };
    }

    // Otherwise create a new object with patterns
    return {
      ...rule,
      patterns: [],
    };
  }

  private async getHubAndRule(
    hubId: string,
    ruleId: string,
    ctx: ComponentContext | StringSelectMenuInteraction,
  ) {
    const hub = await this.hubService.fetchHub(hubId);
    if (!hub || !(await runHubRoleChecksAndReply(hub, ctx, { checkIfManager: true }))) {
      return { hub: null, rule: null };
    }

    const rule = await hub.fetchAntiSwearRule(ruleId);
    if (!rule) {
      const locale = await fetchUserLocale(ctx.user.id);

      await ctx.reply({
        content: t('hub.blockwords.notFound', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
        flags: ['Ephemeral'],
      });
      return { hub, rule: null };
    }

    // Use our helper method to ensure the rule has patterns
    const ruleWithPatterns = this.ensureRuleHasPatterns(rule);

    return { hub, rule: ruleWithPatterns };
  }
}
