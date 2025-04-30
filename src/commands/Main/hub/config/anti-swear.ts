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

import HubCommand, { hubOption } from '#src/commands/Main/hub/index.js';
import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { HubService } from '#src/services/HubService.js';
import { numberEmojis } from '#src/utils/Constants.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { runHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { supportedLocaleCodes, t } from '#src/utils/Locale.js';
import {
  ACTION_LABELS,
  buildAntiSwearModal,
  buildBlockWordActionsSelect,
  buildEditAntiSwearRuleButton,
  sanitizeWords,
} from '#src/utils/moderation/antiSwear.js';
import { fetchUserLocale, getReplyMethod } from '#src/utils/Utils.js';
import { BlockWord, BlockWordAction } from '#src/generated/prisma/client/client.js';
import {
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  ContainerBuilder,
  MessageFlags,
  ModalSubmitInteraction,
  SectionBuilder,
  SeparatorSpacingSize,
  StringSelectMenuInteraction,
  TextDisplayBuilder,
  type AutocompleteInteraction,
} from 'discord.js';

const CUSTOM_ID_PREFIX = 'antiSwear' as const;

export default class HubConfigAntiSwearSubcommand extends BaseCommand {
  private readonly hubService = new HubService();
  private readonly MAX_RULES = 2;

  constructor() {
    super({
      name: 'anti-swear',
      description: '🤬 Configure the anti-swear blocking rules for the hub.',
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

    const container = this.buildAntiSwearContainer(antiSwearRules, hub.id, locale, ctx.client);

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
  private buildAntiSwearContainer(
    rules: BlockWord[],
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
  async handleRuleSelection(interaction: ButtonInteraction | StringSelectMenuInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId, ruleId] = customId.args;

    // If this is a select menu interaction, get the selected rule ID from values
    const selectedRuleId = 'values' in interaction ? interaction.values[0] : ruleId;

    const { rule } = await this.getHubAndRule(hubId, selectedRuleId, interaction);
    if (!rule) return;

    const locale = await fetchUserLocale(interaction.user.id);
    const container = this.buildRuleDetailContainer(rule, hubId, locale, interaction.client);

    await interaction.update({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  /**
   * Builds a Components v2 container for a specific rule's details
   */
  private buildRuleDetailContainer(
    rule: BlockWord,
    hubId: string,
    locale: supportedLocaleCodes,
    client: Client,
  ): ContainerBuilder {
    const container = new ContainerBuilder();

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
          words: rule.words ? `\`\`\`\n${rule.words.replace(/\.\*/g, '*')}\n\`\`\`` : '',
        },
      )}## ${t('hub.blockwords.embedFields.actionsName', locale)}\n${actionsList}`,
    );

    container.addTextDisplayComponents(ruleDetailsText);

    // Actions select menu
    const actionsSelect = buildBlockWordActionsSelect(hubId, rule.id, rule.actions, locale);
    container.addActionRowComponents((row) => row.addComponents(actionsSelect.components[0]));

    // Buttons for navigation and actions
    const backButton = new ButtonBuilder()
      .setCustomId(new CustomID().setIdentifier(CUSTOM_ID_PREFIX, 'home').setArgs(hubId).toString())
      .setEmoji(getEmoji('back', client))
      .setStyle(ButtonStyle.Secondary);

    const editButton = buildEditAntiSwearRuleButton(hubId, rule.id);

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

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'del-rule')
  async handleDeleteRule(interaction: ButtonInteraction) {
    await interaction.deferReply();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId, ruleId] = customId.args;

    const { rule } = await this.getHubAndRule(hubId, ruleId, interaction);
    if (!rule) return;

    await db.blockWord.delete({ where: { id: rule.id } });

    const locale = await fetchUserLocale(interaction.user.id);
    await interaction.editReply(
      t('hub.blockwords.deleted', locale, {
        emoji: getEmoji('tick_icon', interaction.client),
      }),
    );
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'add-rule')
  async handleCreateRule(interaction: ButtonInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId] = customId.args;

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub || !(await runHubRoleChecksAndReply(hub, interaction, { checkIfManager: true }))) {
      return;
    }
    const locale = await fetchUserLocale(interaction.user.id);
    const modal = buildAntiSwearModal(hub.id, { locale });
    await interaction.showModal(modal);
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'editRule')
  async handleEditButtons(interaction: ButtonInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId, ruleId] = customId.args;

    const { hub, rule: presetRule } = await this.getHubAndRule(hubId, ruleId, interaction);
    if (!presetRule) return;

    const locale = await fetchUserLocale(interaction.user.id);
    const modal = buildAntiSwearModal(hub.id, { locale, presetRule });
    await interaction.showModal(modal);
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'home')
  async handleHomeButton(interaction: ButtonInteraction) {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId] = customId.args;

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) return;

    const antiSwearRules = await hub.fetchAntiSwearRules();
    const locale = await fetchUserLocale(interaction.user.id);

    const container = this.buildAntiSwearContainer(
      antiSwearRules,
      hub.id,
      locale,
      interaction.client,
    );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'modal')
  async handleModals(interaction: ModalSubmitInteraction) {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId, ruleId] = customId.args as [string, string?];

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) return;

    const locale = await fetchUserLocale(interaction.user.id);

    const name = interaction.fields.getTextInputValue('name');
    const newWords = sanitizeWords(interaction.fields.getTextInputValue('words'));
    let rule;

    // new rule
    if (!ruleId) {
      if ((await hub.fetchAntiSwearRules()).length >= this.MAX_RULES) {
        await interaction.followUp({
          content: t('hub.blockwords.maxRules', locale, {
            emoji: getEmoji('x_icon', interaction.client),
          }),
          flags: ['Ephemeral'],
        });
        return;
      }

      rule = await db.blockWord.create({
        data: { hubId, name, createdBy: interaction.user.id, words: newWords },
      });
    }
    else {
      rule = await db.blockWord.update({
        where: { id: ruleId },
        data: { words: newWords, name },
      });
    }

    const container = this.buildRuleDetailContainer(rule, hubId, locale, interaction.client);

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'actions')
  async handleActionSelection(interaction: StringSelectMenuInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId, ruleId] = customId.args;
    const selectedActions = interaction.values as BlockWordAction[];

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub || !(await runHubRoleChecksAndReply(hub, interaction, { checkIfManager: true }))) {
      return;
    }

    const rule = await db.blockWord.findUnique({ where: { id: ruleId } });
    if (!rule) {
      await this.sendRuleNotFoundResponse(interaction);
      return;
    }

    await db.blockWord.update({
      where: { id: ruleId },
      data: { actions: selectedActions },
    });

    const actionLabels = selectedActions.map((action) => ACTION_LABELS[action]).join(', ');

    await interaction.reply({
      content: t('hub.blockwords.actionsUpdated', await fetchUserLocale(interaction.user.id), {
        emoji: getEmoji('tick_icon', interaction.client),
        actions: actionLabels,
      }),
      flags: ['Ephemeral'],
    });
  }

  private async sendRuleNotFoundResponse(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
  ) {
    const replyMethod = getReplyMethod(interaction);
    const locale = await fetchUserLocale(interaction.user.id);
    await interaction[replyMethod]({
      content: t('hub.blockwords.notFound', locale, {
        emoji: getEmoji('x_icon', interaction.client),
      }),
      flags: ['Ephemeral'],
    });
  }
  private async getHubAndRule(
    hubId: string,
    ruleId: string,
    interaction: ButtonInteraction | StringSelectMenuInteraction,
  ) {
    const hub = await this.hubService.fetchHub(hubId);
    if (!hub || !(await runHubRoleChecksAndReply(hub, interaction, { checkIfManager: true }))) {
      return { hub: null, rule: null };
    }

    const rule = await hub.fetchAntiSwearRule(ruleId);
    if (!rule) {
      const replyMethod = getReplyMethod(interaction);
      const locale = await fetchUserLocale(interaction.user.id);

      await interaction[replyMethod]({
        content: t('hub.blockwords.notFound', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
        flags: ['Ephemeral'],
      });
      return { hub, rule: null };
    }

    return { hub, rule };
  }
}
