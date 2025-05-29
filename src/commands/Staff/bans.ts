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
import { ServerBan, Ban } from '#src/generated/prisma/client/index.js';
import ServerBanManager from '#src/managers/ServerBanManager.js';
import BanManager from '#src/managers/UserBanManager.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Logger from '#src/utils/Logger.js';
import { PaginationManager } from '#src/utils/ui/PaginationManager.js';
import { stripIndents } from 'common-tags';
import { ApplicationCommandOptionType, Client, ContainerBuilder, MessageFlags } from 'discord.js';

type BanType = 'user' | 'server';
type FilterType = 'user' | 'server' | 'permanent' | 'temporary' | 'all';
type BanEntry = {
  type: BanType;
  data: Ban | ServerBan;
  displayName: string;
  moderatorName: string;
};

export default class Bans extends BaseCommand {
  constructor() {
    super({
      name: 'bans',
      description: '📋 View and manage all active bans with filtering and search options',
      staffOnly: true,
      types: { slash: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'filter',
          description: 'Filter bans by type',
          required: false,
          choices: [
            { name: '👤 User Bans Only', value: 'user' },
            { name: '🌐 Server Bans Only', value: 'server' },
            { name: '♾️ Permanent Bans', value: 'permanent' },
            { name: '⏰ Temporary Bans', value: 'temporary' },
            { name: '📊 All Bans', value: 'all' },
          ],
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'search',
          description: 'Search bans by username, server name, reason, or moderator',
          required: false,
        },
      ],
    });
  }

  async execute(ctx: Context) {
    const filter = (ctx.options.getString('filter') as FilterType) || 'all';
    const search = ctx.options.getString('search');

    try {
      const allBans = await this.fetchAndFilterBans(ctx, filter, search);

      if (allBans.length === 0) {
        await this.sendNoBansMessage(ctx, search);
        return;
      }

      await this.startPagination(ctx, allBans);
    }
    catch (error) {
      Logger.error('Error in bans command:', error);
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Failed to load bans: ${error instanceof Error ? error.message : 'Unknown error'}`,
        flags: ['Ephemeral'],
      });
    }
  }

  private async fetchAndFilterBans(
    ctx: Context,
    filter: FilterType,
    search?: string | null,
  ): Promise<BanEntry[]> {
    const [userBans, serverBans] = await Promise.all([
      new BanManager().getActiveBans(),
      new ServerBanManager().getActiveBans(),
    ]);

    const allBans: BanEntry[] = [];

    if (this.shouldIncludeUserBans(filter)) {
      const processedUserBans = await this.processUserBans(ctx, userBans, filter, search);
      allBans.push(...processedUserBans);
    }

    if (this.shouldIncludeServerBans(filter)) {
      const processedServerBans = await this.processServerBans(ctx, serverBans, filter, search);
      allBans.push(...processedServerBans);
    }

    return allBans.sort(
      (a, b) => new Date(b.data.createdAt).getTime() - new Date(a.data.createdAt).getTime(),
    );
  }

  private shouldIncludeUserBans(filter: FilterType): boolean {
    return ['all', 'user', 'permanent', 'temporary'].includes(filter);
  }

  private shouldIncludeServerBans(filter: FilterType): boolean {
    return ['all', 'server', 'permanent', 'temporary'].includes(filter);
  }

  private async processUserBans(
    ctx: Context,
    bans: Ban[],
    filter: FilterType,
    search?: string | null,
  ): Promise<BanEntry[]> {
    const results: BanEntry[] = [];

    for (const ban of bans) {
      if (!this.matchesDurationFilter(ban, filter)) continue;

      const [user, moderator] = await Promise.all([
        ctx.client.users.fetch(ban.userId).catch(() => null),
        ctx.client.users.fetch(ban.moderatorId).catch(() => null),
      ]);

      const displayName = user?.username || `Unknown User (${ban.userId})`;
      const moderatorName = moderator?.username || 'Unknown';

      if (search && !this.matchesSearch(search, displayName, ban.reason, moderatorName, ban.id)) {
        continue;
      }

      results.push({ type: 'user', data: ban, displayName, moderatorName });
    }

    return results;
  }

  private async processServerBans(
    ctx: Context,
    bans: ServerBan[],
    filter: FilterType,
    search?: string | null,
  ): Promise<BanEntry[]> {
    const results: BanEntry[] = [];

    for (const ban of bans) {
      if (!this.matchesDurationFilter(ban, filter)) continue;

      const [server, moderator] = await Promise.all([
        ctx.client.guilds.fetch(ban.serverId).catch(() => null),
        ctx.client.users.fetch(ban.moderatorId).catch(() => null),
      ]);

      const displayName = server?.name || `Unknown Server (${ban.serverId})`;
      const moderatorName = moderator?.username || 'Unknown';

      if (search && !this.matchesSearch(search, displayName, ban.reason, moderatorName, ban.id)) {
        continue;
      }

      results.push({ type: 'server', data: ban, displayName, moderatorName });
    }

    return results;
  }

  private matchesDurationFilter(ban: Ban | ServerBan, filter: FilterType): boolean {
    if (filter === 'permanent') return ban.type === 'PERMANENT';
    if (filter === 'temporary') return ban.type === 'TEMPORARY';
    return true;
  }

  private matchesSearch(
    search: string,
    displayName: string,
    reason: string,
    moderatorName: string,
    id: string,
  ): boolean {
    const searchLower = search.toLowerCase();
    return [displayName, reason, moderatorName, id].some((field) =>
      field.toLowerCase().includes(searchLower),
    );
  }

  private async sendNoBansMessage(ctx: Context, search?: string | null): Promise<void> {
    const ui = new UIComponents(ctx.client);
    const message = search
      ? `No bans found matching your search criteria: "${search}"`
      : 'No active bans found with the selected filter.';

    const container = ui.createInfoMessage('No Bans Found', message);
    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
    });
  }

  private async startPagination(ctx: Context, bans: BanEntry[]): Promise<void> {
    const pagination = new PaginationManager({
      client: ctx.client,
      identifier: 'bans_list',
      items: bans,
      itemsPerPage: 5,
      contentGenerator: (pageIndex, items, totalPages, totalItems) =>
        this.generateBanListPage(ctx.client, pageIndex, items, totalPages, totalItems),
      ephemeral: true,
    });

    await pagination.start(ctx);
  }

  private generateBanListPage(
    client: Client,
    pageIndex: number,
    items: BanEntry[],
    totalPages: number,
    totalItems: number,
  ): ContainerBuilder {
    const ui = new UIComponents(client);
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(
      ui.createHeader(
        'Active Bans',
        `Page ${pageIndex + 1} of ${totalPages} • ${totalItems} total bans`,
        'hammer_icon',
      ),
    );

    items.forEach((ban, index) => {
      const banNumber = pageIndex * 5 + index + 1;
      const banInfo = this.formatBanInfo(ban, banNumber);
      container.addTextDisplayComponents(ui.createSubsection('', banInfo));
    });

    return container;
  }

  private formatBanInfo(ban: BanEntry, banNumber: number): string {
    const emoji = ban.type === 'user' ? '👤' : '🌐';
    const banTypeText = ban.type === 'user' ? 'User Ban' : 'Server Ban';
    const durationText = this.formatBanDuration(ban.data);
    const truncatedReason =
      ban.data.reason.length > 100 ? `${ban.data.reason.slice(0, 100)}...` : ban.data.reason;

    return stripIndents`
      **${banNumber}. ${emoji} ${ban.displayName}**
      **Type:** ${banTypeText} • **Duration:** ${durationText}
      **Reason:** ${truncatedReason}
      **Moderator:** ${ban.moderatorName} • **ID:** \`${ban.data.id}\`
      **Issued:** <t:${Math.floor(new Date(ban.data.createdAt).getTime() / 1000)}:R>`;
  }

  private formatBanDuration(ban: Ban | ServerBan): string {
    if (ban.type === 'PERMANENT') return 'Permanent';

    if (!ban.expiresAt) return 'Unknown';

    const now = new Date();
    const expires = new Date(ban.expiresAt);

    if (expires <= now) return 'Expired';

    const diff = expires.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    return days > 0 ? `${days}d ${hours}h remaining` : `${hours}h remaining`;
  }
}
