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

import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { ReportStatus } from '#src/generated/prisma/client/client.js';
import { ReportService } from '#src/services/ReportService.js';
import { CustomID } from '#src/utils/CustomID.js';
import { handleError } from '#src/utils/Utils.js';
import db from '#utils/Db.js';
import {
  ActionRowBuilder,
  APIContainerComponent,
  ButtonBuilder,
  ButtonStyle,
  ComponentInContainer,
  ComponentType,
  TopLevelComponent,
} from 'discord.js';

export default class ReportActionV2Handler {
  /**
   * Updates button components to show only a single disabled button with the action taken
   */
  private async updateButtonComponents(
    ctx: ComponentContext,
    _reportId: string,
    newStatus: ReportStatus,
    actionLabel: string,
  ): Promise<void> {
    await ctx.deferUpdate();
    const message = ctx.interaction.message;
    if (!message?.components) return;

    const { updatedComponents, containerIndex } = this.processMessageComponents(
      message.components,
      newStatus,
      actionLabel,
      ctx.user.username,
    );

    const components = message.components.map((r) => r.toJSON());
    if (containerIndex !== null && updatedComponents) {
      const container = components.find((row, i) => i === containerIndex) as
        | APIContainerComponent
        | undefined;

      if (!container) return;

      // update the container's components
      container.components.splice(
        container.components.length - 1,
        2,
        updatedComponents.toJSON(),
      );
    }

    await ctx.editReply({ components });
  }

  /**
   * Processes all message components and returns updated components
   */
  private processMessageComponents(
    components: TopLevelComponent[],
    newStatus: ReportStatus,
    actionLabel: string,
    username: string,
  ): { updatedComponents: ActionRowBuilder<ButtonBuilder> | null; containerIndex: number | null } {
    let updatedComponents: ActionRowBuilder<ButtonBuilder> | null = null;
    let index: number | null = null;

    components.forEach((row, i) => {
      if (row.type !== ComponentType.Container) return;
      index = i;

      if (this.findReportActionRowIndex(row.components) === null) return;
      const processedRow = this.createReplacementRow(newStatus, actionLabel, username);

      if (processedRow) updatedComponents = processedRow;
    });

    return { updatedComponents, containerIndex: index };
  }

  /**
   * Identifies if a row contains report action buttons
   */
  private findReportActionRowIndex(components: ComponentInContainer[]): number | null {
    if (!components.length) return null;

    let index: number | null = null;
    components.forEach((component) => {
      if (component.type !== ComponentType.ActionRow) return;
      const foundIndex = component.components.findIndex((btn) =>
        CustomID.parseCustomId(btn.customId || '').prefix.includes('reportAction'),
      );

      if (foundIndex !== -1) index = foundIndex;
    });
    return index;
  }

  /**
   * Creates the replacement row with a single completed action button
   */
  private createReplacementRow(
    newStatus: ReportStatus,
    actionLabel: string,
    username: string,
  ): ActionRowBuilder<ButtonBuilder> {
    const completedButton = this.createCompletedActionButton(newStatus, actionLabel, username);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(completedButton);
  }

  /**
   * Creates the completed action button with appropriate emoji and label
   */
  private createCompletedActionButton(
    newStatus: ReportStatus,
    actionLabel: string,
    username: string,
  ): ButtonBuilder {
    const statusEmoji = this.getStatusEmoji(newStatus);

    return new ButtonBuilder()
      .setCustomId('report_action_completed')
      .setLabel(`${statusEmoji} ${actionLabel} by @${username}`)
      .setDisabled(true)
      .setStyle(ButtonStyle.Secondary);
  }

  /**
   * Gets the appropriate emoji for the report status
   */
  private getStatusEmoji(status: ReportStatus): string {
    switch (status) {
      case ReportStatus.RESOLVED:
        return '✅';
      case ReportStatus.IGNORED:
        return '❌';
      default:
        return '⏳';
    }
  }

  /**
   * Send DM notification to the reporter using ReportService
   */
  private async notifyReporter(
    ctx: ComponentContext,
    reportId: string,
    status: ReportStatus,
  ): Promise<void> {
    await ReportService.sendReporterNotification(ctx.client, reportId, status);
  }

  @RegisterInteractionHandler('reportAction', 'resolve')
  async handleResolveReport(ctx: ComponentContext): Promise<void> {
    const [reportId] = ctx.customId.args;

    try {
      // Update report status in database
      await db.report.update({
        where: { id: reportId },
        data: {
          status: ReportStatus.RESOLVED,
          handledBy: ctx.user.id,
          handledAt: new Date(),
        },
      });

      // Update UI
      await this.updateButtonComponents(ctx, reportId, ReportStatus.RESOLVED, 'Resolved');

      // Notify reporter
      await this.notifyReporter(ctx, reportId, ReportStatus.RESOLVED);
    }
    catch (error) {
      handleError(error, {
        repliable: ctx.interaction,
        comment: `Failed to resolve report ${reportId}`,
      });
    }
  }

  @RegisterInteractionHandler('reportAction', 'ignore')
  async handleIgnoreReport(ctx: ComponentContext): Promise<void> {
    const [reportId] = ctx.customId.args;

    try {
      // Update report status in database
      await db.report.update({
        where: { id: reportId },
        data: {
          status: ReportStatus.IGNORED,
          handledBy: ctx.user.id,
          handledAt: new Date(),
        },
      });

      // Update UI
      await this.updateButtonComponents(ctx, reportId, ReportStatus.IGNORED, 'Ignored');

      // Notify reporter
      await this.notifyReporter(ctx, reportId, ReportStatus.IGNORED);
    }
    catch (error) {
      handleError(error, {
        repliable: ctx.interaction,
        comment: `Failed to ignore report ${reportId}`,
      });
    }
  }

  @RegisterInteractionHandler('reply_context_view')
  async handleViewContext(ctx: ComponentContext): Promise<void> {
    const [messageId] = ctx.customId.args;

    try {
      await ctx.deferReply({ flags: ['Ephemeral'] });

      // Extract message ID from the report log to find the reply context
      const message = ctx.interaction.message;
      if (!message) {
        await ctx.editReply({ content: '❌ Could not find the original message.' });
        return;
      }

      // Find the original message and its reply context
      const originalMessage = await db.message.findUnique({
        where: { id: messageId },
        include: {
          referredTo: true,
        },
      });

      if (!originalMessage?.referredTo) {
        await ctx.editReply({ content: '❌ No reply context found for this message.' });
        return;
      }

      // Get the author of the original message
      const authorId = originalMessage.referredTo.authorId;
      const originalAuthor = await ctx.client.users.fetch(authorId).catch(() => null);

      const embed = {
        title: '💬 Reply Context',
        description: `**Original Message Content:**\n\`\`\`\n${originalMessage.referredTo.content || 'No content'}\n\`\`\``,
        fields: [
          {
            name: '👤 Original Author',
            value: originalAuthor
              ? `${originalAuthor.username} (\`${originalAuthor.id}\`)`
              : `Unknown User (\`${originalMessage.referredTo.authorId}\`)`,
            inline: true,
          },
          {
            name: '📅 Sent At',
            value: `<t:${Math.floor(originalMessage.referredTo.createdAt.getTime() / 1000)}:F>`,
            inline: true,
          },
          {
            name: '🆔 Message ID',
            value: `\`${originalMessage.referredTo.id}\``,
            inline: true,
          },
        ],
        color: 0x5865f2,
        timestamp: new Date().toISOString(),
      };

      await ctx.editReply({ embeds: [embed] });
    }
    catch (error) {
      handleError(error, {
        repliable: ctx.interaction,
        comment: 'Failed to view reply context',
      });
    }
  }
}
