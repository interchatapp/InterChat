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
import { HubValidator } from '#src/modules/HubValidator.js';
import { type HubCreationData, HubService } from '#src/services/HubService.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { fetchUserLocale, handleError } from '#src/utils/Utils.js';
import Constants from '#utils/Constants.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export default class HubCreateSubCommand extends BaseCommand {
  constructor() {
    super({
      name: 'create',
      description: '✨ Create a new hub.',
      types: { slash: true, prefix: true },
    });
  }
  readonly cooldown = 10 * 60 * 1000; // 10 mins
  private readonly hubService = new HubService();

  async execute(ctx: Context) {
    const modal = HubCreateSubCommand.hubCreateModal(await ctx.getLocale());
    await ctx.showModal(modal);
  }

  @RegisterInteractionHandler('hub_create_modal')
  async handleModals(ctx: ComponentContext): Promise<void> {
    if (!ctx.isModalSubmit()) return;

    await ctx.deferReply({ flags: ['Ephemeral'] });

    const locale = await fetchUserLocale(ctx.user.id);

    try {
      const hubData = {
        name: ctx.getModalFieldValue('name'),
        description: ctx.getModalFieldValue('description'),
        iconUrl: ctx.getModalFieldValue('icon'),
        bannerUrl: ctx.getModalFieldValue('banner'),
        ownerId: ctx.user.id,
      };
      await this.processHubCreation(ctx, hubData, locale);
    }
    catch (error) {
      handleError(error, { repliable: ctx.interaction });
    }
  }

  private async processHubCreation(
    ctx: ComponentContext,
    hubData: HubCreationData,
    locale: supportedLocaleCodes,
  ): Promise<void> {
    const validator = new HubValidator(locale, ctx.client);
    const existingHubs = await this.hubService.getExistingHubs(hubData.ownerId, hubData.name);

    const validationResult = await validator.validateNewHub(hubData, existingHubs);
    if (!validationResult.isValid) {
      await ctx.reply({
        content: validationResult.error,
        flags: ['Ephemeral'],
      });
      return;
    }

    await this.hubService.createHub(hubData);
    await this.handleSuccessfulCreation(ctx, hubData.name, locale);
  }

  private async handleSuccessfulCreation(
    ctx: ComponentContext,
    hubName: string,
    locale: supportedLocaleCodes,
  ): Promise<void> {
    const successEmbed = new EmbedBuilder()
      .setColor('Green')
      .setDescription(
        stripIndents`${t('hub.create.success', locale, {
          name: hubName,
          support_invite: Constants.Links.SupportInvite,
          donateLink: Constants.Links.Donate,
        })}
        
        ${getEmoji('wand_icon', ctx.client)} **Pro tip:** Use our [dashboard](${Constants.Links.Website}/dashboard) for easier hub management with a visual interface!`,
      )
      .setTimestamp();

    await ctx.editReply({ embeds: [successEmbed] });
  }

  static hubCreateModal(locale: supportedLocaleCodes): ModalBuilder {
    return new ModalBuilder()
      .setTitle(t('hub.create.modal.title', locale))
      .setCustomId(new CustomID('hub_create_modal').toString())
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setLabel(t('hub.create.modal.name.label', locale))
            .setPlaceholder(t('hub.create.modal.name.placeholder', locale))
            .setMinLength(2)
            .setMaxLength(100)
            .setStyle(TextInputStyle.Short)
            .setCustomId('name'),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setLabel(t('hub.create.modal.description.label', locale))
            .setPlaceholder(t('hub.create.modal.description.placeholder', locale))
            .setMaxLength(1024)
            .setStyle(TextInputStyle.Paragraph)
            .setCustomId('description'),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setLabel(t('hub.create.modal.icon.label', locale))
            .setPlaceholder(t('hub.create.modal.icon.placeholder', locale))
            .setMaxLength(300)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setCustomId('icon'),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setLabel(t('hub.create.modal.banner.label', locale))
            .setPlaceholder(t('hub.create.modal.banner.placeholder', locale))
            .setMaxLength(300)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setCustomId('banner'),
        ),
        // new ActionRowBuilder<TextInputBuilder>().addComponents(
        //   new TextInputBuilder()
        //     .setLabel('Language')
        //     .setPlaceholder('Pick a language for this hub.')
        //     .setStyle(TextInputStyle.Short)
        //     .setCustomId('language'),
        // ),
      );
  }
}
