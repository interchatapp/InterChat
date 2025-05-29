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
import ServerBanManager from '#src/managers/ServerBanManager.js';
import BanManager from '#src/managers/UserBanManager.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import Logger from '#src/utils/Logger.js';
import { MessageFlags } from 'discord.js';

export default class BanConfirmationHandler {
  /**
   * Execute the ban after confirmation
   */
  @RegisterInteractionHandler('ban', 'execute')
  async handleExecuteBan(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [banType, targetId, duration, reason] = ctx.customId.args;

    try {
      if (banType === 'user') {
        await this.executeUserBan(ctx, targetId, duration, reason);
      }
      else if (banType === 'server') {
        await this.executeServerBan(ctx, targetId, duration, reason);
      }
    }
    catch (error) {
      Logger.error('Error executing ban:', error);

      const ui = new UIComponents(ctx.client);
      const container = ui.createErrorMessage(
        'Ban Failed',
        `Failed to execute ban: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  /**
   * Cancel the ban operation
   */
  @RegisterInteractionHandler('ban', 'cancel')
  async handleCancelBan(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const ui = new UIComponents(ctx.client);
    const container = ui.createInfoMessage(
      'Ban Cancelled',
      'The ban operation has been cancelled.',
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Execute user ban
   */
  private async executeUserBan(
    ctx: ComponentContext,
    userId: string,
    duration: string,
    reason: string,
  ): Promise<void> {
    const banManager = new BanManager();

    // Check if user is already banned
    const banCheck = await banManager.isUserBanned(userId);
    if (banCheck.isBanned) {
      throw new Error(`User is already banned (Ban ID: ${banCheck.ban?.id})`);
    }

    // Parse duration
    const { banType, durationMs } = this.parseDuration(duration);

    // Create the ban
    const ban = await banManager.createBan({
      userId,
      moderatorId: ctx.user.id,
      reason,
      type: banType,
      duration: durationMs,
    });

    // Get user info
    const user = await ctx.client.users.fetch(userId).catch(() => null);
    const username = user?.username || `Unknown User (${userId})`;
    const durationText = banType === 'TEMPORARY' && durationMs
      ? ` for ${this.formatDuration(durationMs)}`
      : ' permanently';

    Logger.info(`User ${username} (${userId}) banned${durationText} by ${ctx.user.username} (Ban ID: ${ban.id})`);

    // Show success message
    const ui = new UIComponents(ctx.client);
    const container = ui.createSuccessMessage(
      'User Ban Applied',
      `${username} has been banned${durationText}.\n**Ban ID:** \`${ban.id}\``,
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Execute server ban
   */
  private async executeServerBan(
    ctx: ComponentContext,
    serverId: string,
    duration: string,
    reason: string,
  ): Promise<void> {
    const serverBanManager = new ServerBanManager();

    // Check if server is already banned
    const banCheck = await serverBanManager.isServerBanned(serverId);
    if (banCheck.isBanned) {
      throw new Error(`Server is already banned (Ban ID: ${banCheck.ban?.id})`);
    }

    // Parse duration
    const { banType, durationMs } = this.parseDuration(duration);

    // Create the ban
    const ban = await serverBanManager.createServerBan({
      serverId,
      moderatorId: ctx.user.id,
      reason,
      type: banType,
      duration: durationMs,
    });

    // Get server info
    const server = await ctx.client.guilds.fetch(serverId).catch(() => null);
    const serverName = server?.name || `Unknown Server (${serverId})`;
    const durationText = banType === 'TEMPORARY' && durationMs
      ? ` for ${this.formatDuration(durationMs)}`
      : ' permanently';

    Logger.info(`Server ${serverName} (${serverId}) banned${durationText} by ${ctx.user.username} (Ban ID: ${ban.id})`);

    // Show success message
    const ui = new UIComponents(ctx.client);
    const container = ui.createSuccessMessage(
      'Server Ban Applied',
      `${serverName} has been banned${durationText}.\n**Ban ID:** \`${ban.id}\``,
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Parse duration string to ban type and milliseconds
   */
  private parseDuration(duration: string): { banType: 'PERMANENT' | 'TEMPORARY'; durationMs?: number } {
    if (duration === 'permanent') {
      return { banType: 'PERMANENT' };
    }

    const durationMap: Record<string, number> = {
      '1h': 60 * 60 * 1000, // 1 hour
      '1d': 24 * 60 * 60 * 1000, // 1 day
      '1w': 7 * 24 * 60 * 60 * 1000, // 1 week
      '30d': 30 * 24 * 60 * 60 * 1000, // 30 days
    };

    const durationMs = durationMap[duration];
    if (!durationMs) {
      throw new Error(`Invalid duration: ${duration}`);
    }

    return { banType: 'TEMPORARY', durationMs };
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
