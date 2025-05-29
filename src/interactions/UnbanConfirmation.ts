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

export default class UnbanConfirmationHandler {
  /**
   * Execute the unban after confirmation
   */
  @RegisterInteractionHandler('unban', 'execute')
  async handleExecuteUnban(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const [banType, banId] = ctx.customId.args;

    try {
      if (banType === 'user') {
        await this.executeUserUnban(ctx, banId);
      }
      else if (banType === 'server') {
        await this.executeServerUnban(ctx, banId);
      }
    }
    catch (error) {
      Logger.error('Error executing unban:', error);

      const ui = new UIComponents(ctx.client);
      const container = ui.createErrorMessage(
        'Unban Failed',
        `Failed to execute unban: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  /**
   * Cancel the unban operation
   */
  @RegisterInteractionHandler('unban', 'cancel')
  async handleCancelUnban(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const ui = new UIComponents(ctx.client);
    const container = ui.createInfoMessage(
      'Unban Cancelled',
      'The unban operation has been cancelled.',
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Execute user unban
   */
  private async executeUserUnban(ctx: ComponentContext, banId: string): Promise<void> {
    const banManager = new BanManager();

    // Get ban details before revoking
    const ban = await banManager.getBanById(banId);
    if (!ban) {
      throw new Error(`Ban with ID ${banId} not found`);
    }

    if (ban.status !== 'ACTIVE') {
      throw new Error(`Ban ${banId} is not active (status: ${ban.status})`);
    }

    // Revoke the ban
    await banManager.revokeBan(banId, ctx.user.id);

    // Get user info
    const user = await ctx.client.users.fetch(ban.userId).catch(() => null);
    const username = user?.username || `Unknown User (${ban.userId})`;

    Logger.info(`User ${username} (${ban.userId}) unbanned by ${ctx.user.username} (Ban ID: ${banId})`);

    // Show success message
    const ui = new UIComponents(ctx.client);
    const container = ui.createSuccessMessage(
      'User Unbanned',
      `${username} has been unbanned and can now use InterChat again.\n**Ban ID:** \`${banId}\``,
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Execute server unban
   */
  private async executeServerUnban(ctx: ComponentContext, banId: string): Promise<void> {
    const serverBanManager = new ServerBanManager();

    // Get ban details before revoking
    const ban = await serverBanManager.getBanById(banId);
    if (!ban) {
      throw new Error(`Server ban with ID ${banId} not found`);
    }

    if (ban.status !== 'ACTIVE') {
      throw new Error(`Server ban ${banId} is not active (status: ${ban.status})`);
    }

    // Revoke the ban
    await serverBanManager.revokeBan(banId, ctx.user.id);

    // Get server info
    const server = await ctx.client.fetchGuild(ban.serverId).catch(() => null);
    const serverName = server?.name || `Unknown Server (${ban.serverId})`;

    Logger.info(`Server ${serverName} (${ban.serverId}) unbanned by ${ctx.user.username} (Ban ID: ${banId})`);

    // Show success message
    const ui = new UIComponents(ctx.client);
    const container = ui.createSuccessMessage(
      'Server Unbanned',
      `${serverName} has been unbanned and can now use InterChat again.\n**Ban ID:** \`${banId}\``,
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }
}
