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

import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import BanManager from '#src/managers/UserBanManager.js';
import ServerBanManager from '#src/managers/ServerBanManager.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Logger from '#src/utils/Logger.js';
import { escapeRegexChars } from '#src/utils/Utils.js';
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
} from 'discord.js';
import { Ban, ServerBan } from '#src/generated/prisma/client/index.js';
import { stripIndents } from 'common-tags';

export default class Unban extends BaseCommand {
  constructor() {
    super({
      name: 'unban',
      description: '🔓 Unban users or servers with advanced search and confirmation',
      staffOnly: true,
      types: { slash: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'target',
          description: 'Search for bans by username, server name, or ban ID',
          required: true,
          autocomplete: true,
        },
      ],
    });
  }

  async execute(ctx: Context) {
    const target = ctx.options.getString('target', true);

    // Parse the target to determine ban type and ID
    const banInfo = this.parseBanTarget(target);
    if (!banInfo) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Invalid ban target. Please use the autocomplete to select a valid ban.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Show confirmation dialog
    await this.showUnbanConfirmation(ctx, banInfo);
  }

  /**
   * Handle autocomplete for ban search
   */
  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focusedValue = escapeRegexChars(interaction.options.getFocused()).toLowerCase();

    try {
      const banManager = new BanManager();
      const serverBanManager = new ServerBanManager();

      // Get active user bans
      const userBans = await banManager.getActiveBans();
      const serverBans = await serverBanManager.getActiveBans();

      const choices: Array<{ name: string; value: string }> = [];

      // Add user bans to choices
      for (const ban of userBans.slice(0, 15)) { // Limit to 15 user bans
        try {
          const user = await interaction.client.users.fetch(ban.userId).catch(() => null);
          const username = user?.username || `Unknown User (${ban.userId})`;
          const durationText = this.formatBanDuration(ban);

          const displayName = `👤 ${username} • ${ban.reason.slice(0, 30)}${ban.reason.length > 30 ? '...' : ''} • ${durationText}`;

          if (displayName.toLowerCase().includes(focusedValue) || ban.id.includes(focusedValue)) {
            choices.push({
              name: displayName.slice(0, 100), // Discord limit
              value: `user:${ban.id}`,
            });
          }
        }
        catch {
          continue;
        }
      }

      // Add server bans to choices
      for (const ban of serverBans.slice(0, 10)) { // Limit to 10 server bans
        try {
          const server = await interaction.client.guilds.fetch(ban.serverId).catch(() => null);
          const serverName = server?.name || `Unknown Server (${ban.serverId})`;
          const durationText = this.formatServerBanDuration(ban);

          const displayName = `🌐 ${serverName} • ${ban.reason.slice(0, 30)}${ban.reason.length > 30 ? '...' : ''} • ${durationText}`;

          if (displayName.toLowerCase().includes(focusedValue) || ban.id.includes(focusedValue)) {
            choices.push({
              name: displayName.slice(0, 100), // Discord limit
              value: `server:${ban.id}`,
            });
          }
        }
        catch {
          continue;
        }
      }

      // Sort by relevance (exact matches first)
      choices.sort((a, b) => {
        const aExact = a.name.toLowerCase().includes(focusedValue);
        const bExact = b.name.toLowerCase().includes(focusedValue);
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return 0;
      });

      await interaction.respond(choices.slice(0, 25)); // Discord limit
    }
    catch (error) {
      Logger.error('Error in unban autocomplete:', error);
      await interaction.respond([]);
    }
  }

  /**
   * Parse ban target from autocomplete value
   */
  private parseBanTarget(target: string): { type: 'user' | 'server'; banId: string } | null {
    const match = target.match(/^(user|server):(.+)$/);
    if (!match) return null;

    return {
      type: match[1] as 'user' | 'server',
      banId: match[2],
    };
  }

  /**
   * Show unban confirmation dialog
   */
  private async showUnbanConfirmation(
    ctx: Context,
    banInfo: { type: 'user' | 'server'; banId: string },
  ) {
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    try {
      let banDetails = '';
      let targetName = '';

      if (banInfo.type === 'user') {
        const banManager = new BanManager();
        const ban = await banManager.getBanById(banInfo.banId);

        if (!ban) {
          await ctx.reply({
            content: `${getEmoji('x_icon', ctx.client)} Ban not found.`,
            flags: ['Ephemeral'],
          });
          return;
        }

        const user = await ctx.client.users.fetch(ban.userId).catch(() => null);
        targetName = user?.username || `Unknown User (${ban.userId})`;
        const durationText = this.formatBanDuration(ban);

        banDetails = stripIndents`
          **Type:** 👤 User Ban
          **Target:** ${targetName} (${ban.userId})
          **Reason:** ${ban.reason}
          **Duration:** ${durationText}
          **Ban ID:** \`${ban.id}\`
          **Issued:** <t:${Math.floor(ban.createdAt.getTime() / 1000)}:R>
        `;
      }
      else {
        const serverBanManager = new ServerBanManager();
        const ban = await serverBanManager.getBanById(banInfo.banId);

        if (!ban) {
          await ctx.reply({
            content: `${getEmoji('x_icon', ctx.client)} Server ban not found.`,
            flags: ['Ephemeral'],
          });
          return;
        }

        const server = await ctx.client.guilds.fetch(ban.serverId).catch(() => null);
        targetName = server?.name || `Unknown Server (${ban.serverId})`;
        const durationText = this.formatServerBanDuration(ban);

        banDetails = stripIndents`
          **Type:** 🌐 Server Ban
          **Target:** ${targetName} (${ban.serverId})
          **Reason:** ${ban.reason}
          **Duration:** ${durationText}
          **Ban ID:** \`${ban.id}\`
          **Issued:** <t:${Math.floor(ban.createdAt.getTime() / 1000)}:R>
        `;
      }

      // Add confirmation header
      container.addTextDisplayComponents(
        ui.createHeader(
          'Confirm Unban',
          'Review ban details before removal',
          'alert_icon',
        ),
      );

      // Add ban details
      container.addTextDisplayComponents(
        ui.createSubsection('Ban Information', banDetails),
      );

      // Add confirmation buttons
      container.addActionRowComponents((row) => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(new CustomID('unban:execute', [banInfo.type, banInfo.banId]).toString())
            .setLabel('Confirm Unban')
            .setStyle(ButtonStyle.Success)
            .setEmoji(getEmoji('tick', ctx.client)),
          new ButtonBuilder()
            .setCustomId(new CustomID('unban:cancel', []).toString())
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(getEmoji('x_icon', ctx.client)),
        );
        return row;
      });

      await ctx.reply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
      });
    }
    catch (error) {
      Logger.error('Error showing unban confirmation:', error);
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Failed to load ban information.`,
        flags: ['Ephemeral'],
      });
    }
  }

  /**
   * Format ban duration for display
   */
  private formatBanDuration(ban: Ban | ServerBan): string {
    if (ban.type === 'PERMANENT') return 'Permanent';
    if (ban.expiresAt) {
      const now = new Date();
      const expires = new Date(ban.expiresAt);
      if (expires <= now) return 'Expired';

      const diff = expires.getTime() - now.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

      if (days > 0) return `${days}d ${hours}h remaining`;
      return `${hours}h remaining`;
    }
    return 'Unknown';
  }

  /**
   * Format server ban duration for display
   */
  private formatServerBanDuration(ban: Ban | ServerBan): string {
    if (ban.type === 'PERMANENT') return 'Permanent';
    if (ban.expiresAt) {
      const now = new Date();
      const expires = new Date(ban.expiresAt);
      if (expires <= now) return 'Expired';

      const diff = expires.getTime() - now.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

      if (days > 0) return `${days}d ${hours}h remaining`;
      return `${hours}h remaining`;
    }
    return 'Unknown';
  }
}
