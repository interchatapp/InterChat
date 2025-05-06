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
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { HubService } from '#src/services/HubService.js';
import Constants from '#src/utils/Constants.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { runHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { supportedLocaleCodes, t } from '#src/utils/Locale.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import {
  ActionRowBuilder,
  AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  ModalBuilder,
  resolveColor,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import HubCommand, { hubOption } from '../index.js';

const CUSTOM_ID_PREFIX = 'hubRules';
const MAX_RULE_LENGTH = 400;
const MAX_RULES = 15;

export default class HubConfigRulesSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'rules',
      description: '📜 Configure the rules for your hub',
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

    const rules = hub.getRules();
    const components = this.buildComponents(rules, hub.id, ctx.client);

    if (!rules.length) {
      await ctx.replyEmbed('hub.rules.noRules', {
        t: { emoji: ctx.getEmoji('info_icon') },
        components,
      });
      return;
    }

    const rulesList = rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n');

    await ctx.replyEmbed('hub.rules.list', {
      t: {
        emoji: ctx.getEmoji('rules_icon'),
        rules: rulesList,
      },
      components,
    });
  }

  public async autocomplete(interaction: AutocompleteInteraction) {
    return await HubCommand.handleManagerCmdAutocomplete(interaction, this.hubService);
  }

  private buildComponents(rules: string[], hubId: string, client: Client) {
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            new CustomID().setIdentifier(CUSTOM_ID_PREFIX, 'add').setArgs(hubId).toString(),
          )
          .setLabel('Add Rule')
          .setEmoji(getEmoji('plus_icon', client))
          .setStyle(ButtonStyle.Success)
          .setDisabled(rules.length >= MAX_RULES),
      ),
    ];

    if (rules.length > 0) {
      components.unshift(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              new CustomID().setIdentifier(CUSTOM_ID_PREFIX, 'select').setArgs(hubId).toString(),
            )
            .setPlaceholder('Select a rule to edit or remove')
            .addOptions(
              rules.map((rule, i) => ({
                label: `Rule ${i + 1}`,
                description: rule.substring(0, 100),
                value: i.toString(),
              })),
            ),
        ),
      );
    }

    return components;
  }

  private buildEmbed(
    emoji: string,
    rules: string[],
    locale: supportedLocaleCodes,
    iconUrl: string | null = null,
  ) {
    const rulesList = rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n');

    return new EmbedBuilder()
      .setDescription(t('hub.rules.list', locale, { emoji, rules: rulesList }))
      .setColor(Constants.Colors.invisible)
      .setThumbnail(iconUrl);
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'add')
  async handleAddRule(ctx: ComponentContext) {
    const [hubId] = ctx.customId.args;

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub || !(await runHubRoleChecksAndReply(hub, ctx, { checkIfManager: true }))) {
      return;
    }

    const locale = await fetchUserLocale(ctx.user.id);

    const rules = hub.getRules();
    if (rules.length >= MAX_RULES) {
      await ctx.reply({
        content: t('hub.rules.maxRulesReached', locale, {
          emoji: getEmoji('x_icon', ctx.client),
          max: MAX_RULES.toString(),
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(
        new CustomID().setIdentifier(CUSTOM_ID_PREFIX, 'modal').setArgs(hubId).toString(),
      )
      .setTitle(t('hub.rules.modal.add.title', locale))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('ruleText')
            .setLabel(t('hub.rules.modal.add.label', locale))
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(t('hub.rules.modal.add.placeholder', locale))
            .setMaxLength(MAX_RULE_LENGTH)
            .setRequired(true),
        ),
      );

    await ctx.showModal(modal);
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'select')
  async handleRuleSelect(ctx: ComponentContext) {
    if (!ctx.isStringSelectMenu() || !ctx.values || ctx.values.length === 0) return;

    const [hubId] = ctx.customId.args;
    const ruleIndex = parseInt(ctx.values[0]);

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub || !(await runHubRoleChecksAndReply(hub, ctx, { checkIfManager: true }))) {
      return;
    }

    const locale = await fetchUserLocale(ctx.user.id);

    const rules = hub.getRules();
    const rule = rules[ruleIndex];

    const components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            new CustomID()
              .setIdentifier(CUSTOM_ID_PREFIX, 'edit')
              .setArgs(hubId, ruleIndex.toString())
              .toString(),
          )
          .setLabel('Edit Rule')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(
            new CustomID()
              .setIdentifier(CUSTOM_ID_PREFIX, 'delete')
              .setArgs(hubId, ruleIndex.toString())
              .toString(),
          )
          .setLabel('Delete Rule')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(
            new CustomID().setIdentifier(CUSTOM_ID_PREFIX, 'back').setArgs(hubId).toString(),
          )
          .setEmoji(getEmoji('back', ctx.client))
          .setStyle(ButtonStyle.Secondary),
      ),
    ];

    await ctx.editReply({
      embeds: [
        {
          fields: [
            {
              name: t('hub.rules.selectedRule', locale, { number: (ruleIndex + 1).toString() }),
              value: rule,
            },
          ],
          color: resolveColor(Constants.Colors.invisible),
        },
      ],
      components,
    });
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'edit')
  async handleEdit(ctx: ComponentContext) {
    const [hubId, indexStr] = ctx.customId.args;
    const ruleIndex = parseInt(indexStr);

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) return;

    const rules = hub.getRules();
    const rule = rules[ruleIndex];

    const locale = await fetchUserLocale(ctx.user.id);

    const modal = new ModalBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier(CUSTOM_ID_PREFIX, 'edit_modal')
          .setArgs(hubId, indexStr)
          .toString(),
      )
      .setTitle(t('hub.rules.modal.edit.title', locale))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('ruleText')
            .setLabel(t('hub.rules.modal.edit.label', locale))
            .setStyle(TextInputStyle.Paragraph)
            .setValue(rule)
            .setPlaceholder(t('hub.rules.modal.edit.placeholder', locale))
            .setMaxLength(MAX_RULE_LENGTH)
            .setRequired(true),
        ),
      );

    await ctx.showModal(modal);
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'edit_modal')
  async handleEditModalSubmit(ctx: ComponentContext) {
    await ctx.deferUpdate();

    if (!ctx.isModalSubmit()) return;

    const [hubId, indexStr] = ctx.customId.args;
    const ruleIndex = Number.parseInt(indexStr);

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub || !(await runHubRoleChecksAndReply(hub, ctx, { checkIfManager: true }))) {
      return;
    }

    const locale = await fetchUserLocale(ctx.user.id);

    const ruleText = ctx.getModalFieldValue('ruleText').trim();
    const rules = hub.getRules();

    // Check for duplicate rules (case insensitive), excluding the current rule being edited
    if (
      rules.some((rule, i) => i !== ruleIndex && rule.toLowerCase() === ruleText?.toLowerCase())
    ) {
      await ctx.reply({
        content: t('hub.rules.ruleExists', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    rules[ruleIndex] = ruleText;
    await hub.updateRules(rules);

    const components = this.buildComponents(rules, hubId, ctx.client);

    await ctx.editReply({
      embeds: [
        this.buildEmbed(getEmoji('rules_icon', ctx.client), rules, locale, hub.data.iconUrl),
      ],
      components,
    });
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'modal')
  async handleModalSubmit(ctx: ComponentContext) {
    await ctx.deferUpdate();

    if (!ctx.isModalSubmit()) return;

    const [hubId] = ctx.customId.args;

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub || !(await runHubRoleChecksAndReply(hub, ctx, { checkIfManager: true }))) {
      return;
    }

    const ruleText = ctx.getModalFieldValue('ruleText').trim();
    const rules = hub.getRules();
    const locale = await fetchUserLocale(ctx.user.id);

    // Check for duplicate rules (case insensitive)
    if (rules.some((rule) => rule.toLowerCase() === ruleText.toLowerCase())) {
      await ctx.reply({
        content: t('hub.rules.ruleExists', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    rules.push(ruleText);
    await hub.updateRules(rules);

    const components = this.buildComponents(rules, hubId, ctx.client);

    await ctx.editReply({
      embeds: [
        this.buildEmbed(getEmoji('rules_icon', ctx.client), rules, locale, hub.data.iconUrl),
      ],
      components,
    });
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'delete')
  async handleDelete(ctx: ComponentContext) {
    const [hubId, indexStr] = ctx.customId.args;
    const ruleIndex = parseInt(indexStr);

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) return;

    const rules = hub.getRules();
    const newRules = rules.filter((_, i) => i !== ruleIndex);
    await hub.updateRules(newRules);
    const locale = await fetchUserLocale(ctx.user.id);

    const components = this.buildComponents(newRules, hubId, ctx.client);
    if (newRules.length === 0) {
      await ctx.editReply({
        embeds: [
          {
            description: t('hub.rules.noRules', locale, {
              emoji: getEmoji('info_icon', ctx.client),
            }),
            color: resolveColor(Constants.Colors.invisible),
          },
        ],
        components,
      });
      return;
    }

    await ctx.editReply({
      embeds: [
        this.buildEmbed(getEmoji('rules_icon', ctx.client), newRules, locale, hub.data.iconUrl),
      ],
      components,
    });
  }

  @RegisterInteractionHandler(CUSTOM_ID_PREFIX, 'back')
  async handleBack(ctx: ComponentContext) {
    const [hubId] = ctx.customId.args;

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) return;

    const rules = hub.getRules();
    const components = this.buildComponents(rules, hubId, ctx.client);
    const locale = await fetchUserLocale(ctx.user.id);

    if (rules.length === 0) {
      await ctx.editReply({
        embeds: [
          {
            description: t('hub.rules.noRules', locale, {
              emoji: getEmoji('info_icon', ctx.client),
            }),
            color: resolveColor(Constants.Colors.invisible),
          },
        ],
        components,
      });
      return;
    }

    await ctx.editReply({
      embeds: [
        this.buildEmbed(getEmoji('rules_icon', ctx.client), rules, locale, hub.data.iconUrl),
      ],
      components,
    });
  }
}
