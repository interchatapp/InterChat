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

import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { buildModPanel } from '#src/interactions/ModPanel.js';
import { HubService } from '#src/services/HubService.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { t } from '#src/utils/Locale.js';
import type { ModAction } from '#src/utils/moderation/modPanel/utils.js';
import { findOriginalMessage, getOriginalMessage } from '#src/utils/network/messageUtils.js';
import { CustomID } from '#utils/CustomID.js';
import type { supportedLocaleCodes } from '#utils/Locale.js';
import { warnUser } from '#utils/moderation/warnUtils.js';
import {
  type ButtonInteraction,
  type ModalSubmitInteraction,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export default class WarnHandler implements ModAction {
  private readonly hubService = new HubService();
  async handle(
    interaction: ButtonInteraction,
    originalMsgId: string,
    locale: supportedLocaleCodes,
  ): Promise<void> {
    const originalMsg = await getOriginalMessage(originalMsgId);

    if (!originalMsg) {
      const errorEmbed = new InfoEmbed().setDescription(
        t('errors.messageNotSentOrExpired', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
      );
      await interaction.reply({ embeds: [errorEmbed], flags: ['Ephemeral'] });
      return;
    }

    const hub = await this.hubService.fetchHub(originalMsg.hubId);
    if (!hub) return;

    const modal = new ModalBuilder()
      .setTitle(t('warn.modal.title', locale))
      .setCustomId(
        new CustomID()
          .setIdentifier('warnModal')
          .setArgs(originalMsg.authorId, originalMsg.hubId)
          .toString(),
      )
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel(t('warn.modal.reason.label', locale))
            .setPlaceholder(t('warn.modal.reason.placeholder', locale))
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500),
        ),
      );

    await interaction.showModal(modal);
  }

  @RegisterInteractionHandler('warnModal')
  async handleModal(interaction: ModalSubmitInteraction) {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [userId, hubId] = customId.args;
    const reason = interaction.fields.getTextInputValue('reason');

    await warnUser({
      userId,
      hubId,
      reason,
      moderatorId: interaction.user.id,
      client: interaction.client,
    });

    const originalMsg = await findOriginalMessage(userId);
    if (!originalMsg) {
      return;
    }

    await interaction.followUp({
      content: t('warn.success', interaction.locale as supportedLocaleCodes, {
        emoji: getEmoji('tick_icon', interaction.client),
        name: (await interaction.client.users.fetch(userId)).username,
      }),
      flags: ['Ephemeral'],
    });

    const { embed, buttons } = await buildModPanel(interaction, originalMsg);
    await interaction.editReply({ embeds: [embed], components: buttons });
  }
}
