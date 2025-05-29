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
import BanManager from '#src/managers/UserBanManager.js';
import ServerBanManager from '#src/managers/ServerBanManager.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getOriginalMessage } from '#src/utils/network/messageUtils.js';
import { checkIfStaff } from '#src/utils/Utils.js';
import { buildModPanel } from './ModPanel.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export default class ModPanelBanFlowHandler {
  /**
   * Show ban type selection (permanent/temporary) for user or server
   */
  @RegisterInteractionHandler('modPanel', 'showBanTypeSelection')
  async handleShowBanTypeSelection(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [targetId, originalMsgId, banType] = ctx.customId.args;

    if (!checkIfStaff(ctx.user.id)) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} You do not have permission to ban ${banType}s.`,
        components: [],
      });
      return;
    }

    await this.showBanTypeSelection(ctx, targetId, originalMsgId, banType as 'user' | 'server');
  }

  /**
   * Show ban type selection UI
   */
  public async showBanTypeSelection(
    ctx: ComponentContext,
    targetId: string,
    originalMsgId: string,
    banType: 'user' | 'server',
  ): Promise<void> {
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    const targetType = banType === 'user' ? 'User' : 'Server';
    const targetEmoji = banType === 'user' ? 'person_icon' : 'globe_icon';

    // Add compact header
    container.addTextDisplayComponents(
      ui.createHeader(
        `${targetType} Ban Options`,
        'Select ban duration and provide reason',
        targetEmoji,
      ),
    );

    // Add ban type selection buttons in a compact layout
    container.addActionRowComponents((row) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('modPanel:showReasonModal', [targetId, originalMsgId, banType, 'PERMANENT']).toString())
          .setLabel('Permanent')
          .setStyle(ButtonStyle.Danger)
          .setEmoji(ctx.getEmoji('hammer_icon')),
        new ButtonBuilder()
          .setCustomId(new CustomID('modPanel:showTempDuration', [targetId, originalMsgId, banType]).toString())
          .setLabel('Temporary')
          .setStyle(ButtonStyle.Primary)
          .setEmoji(ctx.getEmoji('clock_icon')),
        new ButtonBuilder()
          .setCustomId(new CustomID('modPanel:backToPanel', [originalMsgId]).toString())
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(ctx.getEmoji('arrow_left')),
      );
      return row;
    });

    await ctx.editReply({
      components: [container.toJSON()],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Show duration selection UI for temporary bans
   */
  @RegisterInteractionHandler('modPanel', 'showTempDuration')
  async handleShowTempDuration(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [targetId, originalMsgId, banType] = ctx.customId.args;
    await this.showTemporaryBanDurationSelection(ctx, targetId, originalMsgId, banType as 'user' | 'server');
  }

  /**
   * Show duration selection UI for temporary bans
   */
  private async showTemporaryBanDurationSelection(
    ctx: ComponentContext,
    targetId: string,
    originalMsgId: string,
    banType: 'user' | 'server',
  ): Promise<void> {
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add compact header
    container.addTextDisplayComponents(
      ui.createHeader(
        'Temporary Ban Duration',
        'Quick duration selection',
        'clock_icon',
      ),
    );

    // Add duration selection buttons in compact layout
    container.addActionRowComponents((row) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('modPanel:showReasonModal', [targetId, originalMsgId, banType, 'TEMPORARY', '3600000']).toString()) // 1 hour
          .setLabel('1h')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(new CustomID('modPanel:showReasonModal', [targetId, originalMsgId, banType, 'TEMPORARY', '86400000']).toString()) // 1 day
          .setLabel('1d')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(new CustomID('modPanel:showReasonModal', [targetId, originalMsgId, banType, 'TEMPORARY', '604800000']).toString()) // 1 week
          .setLabel('1w')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(new CustomID('modPanel:showReasonModal', [targetId, originalMsgId, banType, 'TEMPORARY', '2592000000']).toString()) // 30 days
          .setLabel('30d')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(new CustomID('modPanel:backToPanel', [originalMsgId]).toString())
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(ctx.getEmoji('arrow_left')),
      );
      return row;
    });

    await ctx.editReply({
      components: [container.toJSON()],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Show reason input modal
   */
  @RegisterInteractionHandler('modPanel', 'showReasonModal')
  async handleShowReasonModal(ctx: ComponentContext) {
    const [targetId, originalMsgId, banType, banDuration, duration] = ctx.customId.args;

    const targetType = banType === 'user' ? 'User' : 'Server';
    const durationText = banDuration === 'TEMPORARY' && duration
      ? ` (${this.formatDuration(parseInt(duration, 10))})`
      : ' (Permanent)';

    const modal = new ModalBuilder()
      .setTitle(`Ban ${targetType}${durationText}`)
      .setCustomId(
        new CustomID('modPanel:executeBan', [targetId, originalMsgId, banType, banDuration, duration || '0']).toString(),
      )
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Reason for ban')
            .setPlaceholder('Violating InterChat rules...')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500)
            .setRequired(true),
        ),
      );

    await ctx.showModal(modal);
  }

  /**
   * Execute the ban
   */
  @RegisterInteractionHandler('modPanel', 'executeBan')
  async handleExecuteBan(ctx: ComponentContext) {
    if (!ctx.isModalSubmit()) return;

    const [targetId, originalMsgId, banType, banDuration, durationStr] = ctx.customId.args;
    const reason = ctx.getModalFieldValue('reason');
    const duration = durationStr !== '0' ? parseInt(durationStr, 10) : undefined;

    if (banType === 'user') {
      await this.executeUserBan(ctx, targetId, originalMsgId, banDuration as 'PERMANENT' | 'TEMPORARY', reason, duration);
    }
    else if (banType === 'server') {
      await this.executeServerBan(ctx, targetId, originalMsgId, banDuration as 'PERMANENT' | 'TEMPORARY', reason, duration);
    }
  }

  /**
   * Execute user ban
   */
  private async executeUserBan(
    ctx: ComponentContext,
    userId: string,
    originalMsgId: string,
    banType: 'PERMANENT' | 'TEMPORARY',
    reason: string,
    duration?: number,
  ): Promise<void> {
    const banManager = new BanManager();

    try {
      const ban = await banManager.createBan({
        userId,
        moderatorId: ctx.user.id,
        reason,
        type: banType,
        duration,
      });

      const user = await ctx.client.users.fetch(userId).catch(() => null);
      const username = user?.username || `Unknown User (${userId})`;
      const durationText = banType === 'TEMPORARY' && duration
        ? ` for ${this.formatDuration(duration)}`
        : ' permanently';

      const ui = new UIComponents(ctx.client);
      const container = ui.createSuccessMessage(
        'Ban Applied',
        `${username} banned${durationText} • ID: \`${ban.id}\``,
      );

      // Add back to panel button
      container.addActionRowComponents((row) => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(new CustomID('modPanel:backToPanel', [originalMsgId]).toString())
            .setLabel('Back to Panel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(ctx.getEmoji('arrow_left')),
        );
        return row;
      });

      await ctx.editReply({
        components: [container.toJSON()],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
    catch (error) {
      const ui = new UIComponents(ctx.client);
      const container = ui.createErrorMessage(
        'Ban Failed',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      container.addActionRowComponents((row) => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(new CustomID('modPanel:backToPanel', [originalMsgId]).toString())
            .setLabel('Back to Panel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(ctx.getEmoji('arrow_left')),
        );
        return row;
      });

      await ctx.editReply({
        components: [container.toJSON()],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  /**
   * Execute server ban
   */
  private async executeServerBan(
    ctx: ComponentContext,
    serverId: string,
    originalMsgId: string,
    banType: 'PERMANENT' | 'TEMPORARY',
    reason: string,
    duration?: number,
  ): Promise<void> {
    const serverBanManager = new ServerBanManager();

    try {
      const ban = await serverBanManager.createServerBan({
        serverId,
        moderatorId: ctx.user.id,
        reason,
        type: banType,
        duration,
      });

      const server = await ctx.client.guilds.fetch(serverId).catch(() => null);
      const serverName = server?.name || `Unknown Server (${serverId})`;
      const durationText = banType === 'TEMPORARY' && duration
        ? ` for ${this.formatDuration(duration)}`
        : ' permanently';

      const ui = new UIComponents(ctx.client);
      const container = ui.createSuccessMessage(
        'Server Ban Applied',
        `${serverName} banned${durationText} • ID: \`${ban.id}\``,
      );

      // Add back to panel button
      container.addActionRowComponents((row) => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(new CustomID('modPanel:backToPanel', [originalMsgId]).toString())
            .setLabel('Back to Panel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(ctx.getEmoji('arrow_left')),
        );
        return row;
      });

      await ctx.editReply({
        components: [container.toJSON()],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
    catch (error) {
      const ui = new UIComponents(ctx.client);
      const container = ui.createErrorMessage(
        'Server Ban Failed',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      container.addActionRowComponents((row) => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(new CustomID('modPanel:backToPanel', [originalMsgId]).toString())
            .setLabel('Back to Panel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(ctx.getEmoji('arrow_left')),
        );
        return row;
      });

      await ctx.editReply({
        components: [container.toJSON()],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  /**
   * Handle back to panel button
   */
  @RegisterInteractionHandler('modPanel', 'backToPanel')
  async handleBackToPanel(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [originalMsgId] = ctx.customId.args;
    const originalMsg = await getOriginalMessage(originalMsgId);

    if (!originalMsg) {
      await ctx.editReply({
        content: `${ctx.getEmoji('x_icon')} Original message not found.`,
        components: [],
      });
      return;
    }

    // Rebuild the modpanel
    const { container, buttons } = await buildModPanel(ctx, originalMsg);
    await ctx.editReply({
      components: [container, ...buttons],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Format duration in milliseconds to human readable string
   */
  private formatDuration(duration: number): string {
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days !== 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }
}
