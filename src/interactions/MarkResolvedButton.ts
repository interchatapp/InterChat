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
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { CustomID } from '#src/utils/CustomID.js';
import { handleError } from '#src/utils/Utils.js';

export const markResolvedButton = () =>
  new ButtonBuilder()
    .setCustomId(new CustomID().setIdentifier('markResolved').toString())
    .setStyle(ButtonStyle.Success)
    .setLabel('Mark Resolved');

export default class MarkResolvedButton {
  @RegisterInteractionHandler('markResolved')
  async handler(interaction: ButtonInteraction): Promise<void> {
    try {
      await interaction.deferUpdate();
      const components = interaction.message.components;
      if (!components) return;

      const rows = components.map((row) =>
        ActionRowBuilder.from(row),
      ) as ActionRowBuilder<MessageActionRowComponentBuilder>[];

      for (const row of rows) {
        for (const component of row.components) {
          if (
            component instanceof ButtonBuilder &&
            component.data.style === ButtonStyle.Success &&
            component.data.custom_id === interaction.customId
          ) {
            component.setLabel(`Resolved by @${interaction.user.username}`);
            component.setDisabled(true);
          }
        }
      }

      await interaction.editReply({ components: rows });
    }
    catch (e) {
      handleError(e, { repliable: interaction, comment: 'Failed to mark the message as resolved' });
    }
  }
}
