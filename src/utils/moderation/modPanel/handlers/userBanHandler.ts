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
  type ButtonInteraction,
  ModalBuilder,
  type ModalSubmitInteraction,
  type Snowflake,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { type ModAction, replyWithUnknownMessage } from '#src/utils/moderation/modPanel/utils.js';
import { getOriginalMessage } from '#src/utils/network/messageUtils.js';
import { handleBan } from '#utils/BanUtils.js';
import { CustomID } from '#utils/CustomID.js';
import type { supportedLocaleCodes } from '#utils/Locale.js';

export default class UserBanHandler implements ModAction {
  async handle(
    interaction: ButtonInteraction,
    originalMsgId: Snowflake,
    locale: supportedLocaleCodes,
  ) {
    const originalMsg = await getOriginalMessage(originalMsgId);

    if (!originalMsg) {
      await replyWithUnknownMessage(interaction, { locale });
      return;
    }

    const modal = new ModalBuilder()
      .setTitle('Ban User')
      .setCustomId(
        new CustomID().setIdentifier('userBanModal').setArgs(originalMsg.authorId).toString(),
      )
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('reason')
            .setPlaceholder('Breaking rules...')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500),
        ),
      );

    await interaction.showModal(modal);
  }

  @RegisterInteractionHandler('userBanModal')
  async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [userId] = customId.args;

    const user = await interaction.client.users.fetch(userId).catch(() => null);
    const reason = interaction.fields.getTextInputValue('reason');

    await handleBan(interaction, userId, user, reason);
  }
}
