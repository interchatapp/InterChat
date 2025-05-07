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
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';

export const markResolvedButton = (hubId: string) =>
  new ButtonBuilder()
    .setCustomId(new CustomID().setIdentifier('markResolved').setArgs(hubId).toString())
    .setStyle(ButtonStyle.Success)
    .setLabel('Mark Resolved');

export const ignoreReportButton = (hubId: string) =>
  new ButtonBuilder()
    .setCustomId(new CustomID().setIdentifier('ignoreReport').setArgs(hubId).toString())
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Ignore');

export default class MarkResolvedButton {
  /**
   * Updates button components in a message
   */
  private async updateButtonComponents(
    ctx: ComponentContext,
    updateFn: (
      component: ButtonBuilder,
      row: ActionRowBuilder<MessageActionRowComponentBuilder>,
      buttonCustomId: string,
    ) => void,
  ): Promise<ActionRowBuilder<MessageActionRowComponentBuilder>[]> {
    await ctx.deferUpdate();
    const components = ctx.interaction.message?.components;
    if (!components) return [];

    const rows = components.map((row) =>
      // FIXME: correct types yeah
      // @ts-expect-error fix the types for components v2 compatibility
      ActionRowBuilder.from(row),
    ) as ActionRowBuilder<MessageActionRowComponentBuilder>[];

    for (const row of rows) {
      for (const component of row.components) {
        if (component instanceof ButtonBuilder && 'custom_id' in component.data) {
          const buttonCustomId = String(component.data.custom_id);
          updateFn(component, row, buttonCustomId);
        }
      }
    }

    await ctx.editReply({ components: rows });
    return rows;
  }

  @RegisterInteractionHandler('markResolved')
  async markResolvedHandler(ctx: ComponentContext): Promise<void> {
    const [hubId] = ctx.customId.args;

    try {
      await this.updateButtonComponents(ctx, (component, _, buttonCustomId) => {
        if (buttonCustomId === ctx.interaction.customId) {
          component
            .setLabel(`Resolved by @${ctx.user.username}`)
            .setDisabled(true)
            .setStyle(ButtonStyle.Secondary);
        }
      });

      // Check if we need to send a DM to the reporter
      const hub = await new HubService().fetchHub(hubId);
      await this.notifyReporter(ctx, hub);
    }
    catch (e) {
      handleError(e, { repliable: ctx.interaction, comment: 'Failed to mark the message as resolved' });
    }
  }

  @RegisterInteractionHandler('ignoreReport')
  async markIgnoredHandler(ctx: ComponentContext): Promise<void> {
    try {
      await this.updateButtonComponents(ctx, (component, _, buttonCustomId) => {
        if (buttonCustomId === ctx.interaction.customId) {
          component
            .setLabel(`Ignored by @${ctx.user.username}`)
            .setDisabled(true)
            .setStyle(ButtonStyle.Secondary);
        }
        // Make "Mark as Resolved" button primary
        else if (buttonCustomId.includes('markResolved')) {
          component.setStyle(ButtonStyle.Primary);
        }
      });
    }
    catch (e) {
      handleError(e, { repliable: ctx.interaction, comment: 'Failed to ignore the report' });
    }
  }

  /**
   * Notifies the original reporter that their report has been resolved
   * @param ctx The button ctx that triggered the resolution
   */
  private async notifyReporter(ctx: ComponentContext, hub: HubManager | null): Promise<void> {
    try {
      const redis = getRedis();
      const reportMessageId = ctx.interaction.message?.id;
      const redisKey = `${RedisKeys.ReportReporter}:${reportMessageId}`;

      // Check if the reporter's ID is still in Redis (within 48 hours)
      const reporterId = await redis.get(redisKey);
      if (!reporterId) {
        // If the key doesn't exist or has expired, don't send a DM
        return;
      }

      // Fetch the reporter user
      const reporter = await ctx.client.users.fetch(reporterId).catch(() => null);
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
