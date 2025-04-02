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
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { CustomID } from '#src/utils/CustomID.js';
import { RedisKeys } from '#src/utils/Constants.js';
import getRedis from '#utils/Redis.js';
import { handleError } from '#src/utils/Utils.js';
import { HubService } from '#src/services/HubService.js';
import HubManager from '#src/managers/HubManager.js';

export const markResolvedButton = (hubId: string) =>
  new ButtonBuilder()
    .setCustomId(new CustomID().setIdentifier('markResolved').setArgs(hubId).toString())
    .setStyle(ButtonStyle.Success)
    .setLabel('Mark Resolved');


export const ignoreReportButton = (hubId: string) =>
  new ButtonBuilder()
    .setCustomId(new CustomID('ignoreReport').setArgs(hubId).toString())
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Ignore');

export default class MarkResolvedButton {
  @RegisterInteractionHandler('markResolved')
  async markResolvedHandler(interaction: ButtonInteraction): Promise<void> {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId] = customId.args;

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
            component
              .setLabel(`Resolved by @${interaction.user.username}`)
              .setDisabled(true)
              .setStyle(ButtonStyle.Secondary);
          }
        }
      }

      await interaction.editReply({ components: rows });

      // Check if we need to send a DM to the reporter
      const hub = await new HubService().fetchHub(hubId);
      await this.notifyReporter(interaction, hub);
    }
    catch (e) {
      handleError(e, { repliable: interaction, comment: 'Failed to mark the message as resolved' });
    }
  }

  @RegisterInteractionHandler('ignoreReport')
  async markIgnoredHandler(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();

    const components = interaction.message.components;
    if (!components) return;

    const rows = components.map((row) =>
      ActionRowBuilder.from(row),
    ) as ActionRowBuilder<MessageActionRowComponentBuilder>[];

    // Update the ignore button
    for (const row of rows) {
      for (const component of row.components) {
        if (
          component instanceof ButtonBuilder &&
          component.data.style === ButtonStyle.Success &&
          component.data.custom_id === interaction.customId
        ) {
          component
            .setLabel(`Ignored by @${interaction.user.username}`)
            .setDisabled(true)
            .setStyle(ButtonStyle.Secondary);
        }
        // Make "Mark as Resolved" button secondary
        else if (
          component instanceof ButtonBuilder &&
          component.data.style === ButtonStyle.Success &&
          component.data.custom_id?.includes('markResolved')
        ) {
          component.setStyle(ButtonStyle.Secondary);
        }
      }
    }

    await interaction.editReply({ components: rows });
  }


  /**
   * Notifies the original reporter that their report has been resolved
   * @param interaction The button interaction that triggered the resolution
   */
  private async notifyReporter(
    interaction: ButtonInteraction,
    hub: HubManager | null,
  ): Promise<void> {
    try {
      const client = interaction.client;
      const redis = getRedis();
      const reportMessageId = interaction.message.id;
      const redisKey = `${RedisKeys.ReportReporter}:${reportMessageId}`;

      // Check if the reporter's ID is still in Redis (within 48 hours)
      const reporterId = await redis.get(redisKey);
      if (!reporterId) {
        // If the key doesn't exist or has expired, don't send a DM
        return;
      }

      // Fetch the reporter user
      const reporter = await client.users.fetch(reporterId).catch(() => null);
      if (!reporter) {
        return;
      }

      // Create and send the DM
      const embed = new EmbedBuilder()
        .setTitle('Thank You for Reporting!')
        .setColor('Green')
        .setDescription(
          `Your report to **${hub?.data.name ?? 'a hub'}** has been reviewed and a moderator has taken action. Thank you for helping us maintain a safe environment.`,
        )
        .setTimestamp();

      await reporter.send({ embeds: [embed] }).catch(() => null);

      // Delete the Redis key after sending the DM
      await redis.del(redisKey);
    }
    catch (error) {
      handleError(error, { comment: 'Failed to notify reporter about resolved report' });
    }
  }
}
