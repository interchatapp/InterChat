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

import {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { HubValidator } from '#src/modules/HubValidator.js';
import { HubService, type HubCreationData } from '#src/services/HubService.js';
import { CustomID } from '#src/utils/CustomID.js';
import { fetchUserLocale, handleError } from '#src/utils/Utils.js';
import Constants from '#utils/Constants.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import type Context from '#src/core/CommandContext/Context.js';
import BaseCommand from '#src/core/BaseCommand.js';

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
    const locale = await fetchUserLocale(ctx.user.id);

    const modal = new ModalBuilder()
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

    await ctx.showModal(modal);
  }

  @RegisterInteractionHandler('hub_create_modal')
  async handleModals(interaction: ModalSubmitInteraction): Promise<void> {
    await interaction.deferReply({ flags: ['Ephemeral'] });

    const locale = await fetchUserLocale(interaction.user.id);

    try {
      const hubData = this.extractHubData(interaction);
      await this.processHubCreation(interaction, hubData, locale);
    }
    catch (error) {
      handleError(error, { repliable: interaction });
    }
  }

  private extractHubData(interaction: ModalSubmitInteraction): HubCreationData {
    return {
      name: interaction.fields.getTextInputValue('name'),
      description: interaction.fields.getTextInputValue('description'),
      iconUrl: interaction.fields.getTextInputValue('icon'),
      bannerUrl: interaction.fields.getTextInputValue('banner'),
      ownerId: interaction.user.id,
    };
  }

  private async processHubCreation(
    interaction: ModalSubmitInteraction,
    hubData: HubCreationData,
    locale: supportedLocaleCodes,
  ): Promise<void> {
    const validator = new HubValidator(locale, interaction.client);
    const existingHubs = await this.hubService.getExistingHubs(hubData.ownerId, hubData.name);

    const validationResult = await validator.validateNewHub(hubData, existingHubs);
    if (!validationResult.isValid) {
      await interaction.followUp({
        content: validationResult.error,
        flags: ['Ephemeral'],
      });
      return;
    }

    await this.hubService.createHub(hubData);
    await this.handleSuccessfulCreation(interaction, hubData.name, locale);
  }

  private async handleSuccessfulCreation(
    interaction: ModalSubmitInteraction,
    hubName: string,
    locale: supportedLocaleCodes,
  ): Promise<void> {
    const successEmbed = new EmbedBuilder()
      .setColor('Green')
      .setDescription(
        t('hub.create.success', locale, {
          name: hubName,
          support_invite: Constants.Links.SupportInvite,
          donateLink: Constants.Links.Donate,
        }),
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });
  }
}
