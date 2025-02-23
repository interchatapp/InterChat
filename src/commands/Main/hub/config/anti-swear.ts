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
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { executeHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { supportedLocaleCodes, t } from '#src/utils/Locale.js';
import {
  ACTION_LABELS,
  buildAntiSwearModal,
  buildAntiSwearRuleEmbed,
  buildBlockWordActionsSelect,
  buildAntiSpamListEmbed,
  buildEditAntiSwearRuleButton,
  sanitizeWords,
} from '#src/utils/moderation/antiSwear.js';
import { fetchUserLocale, getReplyMethod } from '#src/utils/Utils.js';
import { BlockWord, BlockWordAction } from '@prisma/client';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
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
    if (!hub || !(await executeHubRoleChecksAndReply(hub, ctx, { checkIfManager: true }))) {
      return;
    }

    const locale = await ctx.getLocale();
    const antiSwearRules = await hub.fetchAntiSwearRules();
    const components = HubConfigAntiSwearSubcommand.buildComponents(antiSwearRules, hub.id, locale);

    if (!antiSwearRules.length) {
      await ctx.replyEmbed('hub.blockwords.noRules', {
        t: { emoji: ctx.getEmoji('slash_icon') },
        flags: ['Ephemeral'],
        components,
      });
      return;
    }

    const embed = buildAntiSpamListEmbed(antiSwearRules, locale, ctx.client);
    await ctx.editOrReply({ embeds: [embed], components });
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
  async handleRuleSelection(interaction: StringSelectMenuInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId] = customId.args;
    const selectedRuleId = interaction.values[0];

    const { rule } = await this.getHubAndRule(hubId, selectedRuleId, interaction);
    if (!rule) return;

    const locale = await fetchUserLocale(interaction.user.id);
    const embed = buildAntiSwearRuleEmbed(rule, locale, interaction.client);
    const components = this.createRuleComponents(rule, hubId, locale, interaction.client);

    await interaction.update({ embeds: [embed], components });
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
    if (!hub || !(await executeHubRoleChecksAndReply(hub, interaction, { checkIfManager: true }))) {
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
    const components = HubConfigAntiSwearSubcommand.buildComponents(antiSwearRules, hub.id, locale);
    if (!antiSwearRules.length) {
      const embed = new InfoEmbed().setDescription(
        t('hub.blockwords.noRules', await fetchUserLocale(interaction.user.id), {
          emoji: getEmoji('slash_icon', interaction.client),
        }),
      );

      await interaction.editReply({ embeds: [embed], components });
      return;
    }
    const embed = buildAntiSpamListEmbed(antiSwearRules, locale, interaction.client);
    await interaction.editReply({ embeds: [embed], components });
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

    const embed = buildAntiSwearRuleEmbed(rule, locale, interaction.client);
    const components = this.createRuleComponents(rule, hubId, locale, interaction.client);
    await interaction.editReply({ embeds: [embed], components });
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'actions')
  async handleActionSelection(interaction: StringSelectMenuInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId, ruleId] = customId.args;
    const selectedActions = interaction.values as BlockWordAction[];

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub || !(await executeHubRoleChecksAndReply(hub, interaction, { checkIfManager: true }))) {
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

  static buildComponents(rules: BlockWord[], hubId: string, locale: supportedLocaleCodes) {
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            new CustomID().setIdentifier(CUSTOM_ID_PREFIX, 'add-rule').setArgs(hubId).toString(),
          )
          .setLabel('Add Rule')
          .setStyle(ButtonStyle.Success),
      ),
    ];

    if (rules.length > 0) {
      // add select menu as first component
      components.unshift(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              new CustomID()
                .setIdentifier(CUSTOM_ID_PREFIX, 'select-rule')
                .setArgs(hubId)
                .toString(),
            )
            .setPlaceholder(t('hub.blockwords.selectRuleToEdit', locale))
            .addOptions(
              rules.map((rule, i) => ({
                label: rule.name,
                value: rule.id,
                emoji: numberEmojis[i + 1],
              })),
            ),
        ),
      );
    }

    return components;
  }

  private createRuleComponents(
    rule: BlockWord,
    hubId: string,
    locale: supportedLocaleCodes,
    client: Client,
  ) {
    return [
      buildBlockWordActionsSelect(hubId, rule.id, rule.actions, locale),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            new CustomID().setIdentifier(CUSTOM_ID_PREFIX, 'home').setArgs(hubId).toString(),
          )
          .setEmoji(getEmoji('back', client))
          .setStyle(ButtonStyle.Secondary),
        buildEditAntiSwearRuleButton(hubId, rule.id),
        new ButtonBuilder()
          .setCustomId(
            new CustomID()
              .setIdentifier(CUSTOM_ID_PREFIX, 'del-rule')
              .setArgs(hubId, rule.id)
              .toString(),
          )
          .setEmoji(getEmoji('deleteDanger_icon', client))
          .setLabel('Delete Rule')
          .setStyle(ButtonStyle.Danger),
      ),
    ];
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
    if (!hub || !(await executeHubRoleChecksAndReply(hub, interaction, { checkIfManager: true }))) {
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
