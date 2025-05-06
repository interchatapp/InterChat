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

import HubCommand from '#src/commands/Hub/hub/index.js';
import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import type ConnectionManager from '#src/managers/ConnectionManager.js';
import { Pagination } from '#src/modules/Pagination.js';
import { HubService } from '#src/services/HubService.js';
import Constants from '#utils/Constants.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import { escapeRegexChars, fetchUserLocale, resolveEval } from '#utils/Utils.js';
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  type Client,
  EmbedBuilder,
  type Guild,
  type GuildBasedChannel,
} from 'discord.js';

interface ConnectionDisplayData {
  serverName?: string;
  channelName?: string;
}

export default class HubServersSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'servers',
      description: '📜 List all servers in your hub.',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'hub',
          description: 'Choose a hub.',
          required: true,
          autocomplete: true,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'server',
          description:
						'Show details about a specific server that is in the hub by its ID.',
          required: false,
        },
      ],
    });
  }

  private getConnectionInfoEmbed(
    locale: supportedLocaleCodes,
    connection: ConnectionManager,
    server: Guild | null,
    channel: GuildBasedChannel | null,
  ) {
    return new EmbedBuilder()
      .setTitle(
        `${server?.name ?? 'Unknown Server'} \`(${connection.data.serverId})\``,
      )
      .setColor(Constants.Colors.primary)
      .setDescription(
        t('hub.servers.connectionInfo', locale, {
          serverId: connection.data.serverId,
          channelName: `${channel?.name ?? 'Unknown Channel'}`,
          channelId: connection.channelId,
          joinedAt: `<t:${Math.round(connection.data.createdAt.getTime() / 1000)}:d>`,
          invite: connection.data.invite ?? 'Not Set.',
          connected: connection.connected ? 'Yes' : 'No',
        }),
      );
  }

  private async fetchConnectionDisplayData(
    client: Client,
    connection: ConnectionManager,
  ): Promise<ConnectionDisplayData | null> {
    const evalArr = await client.cluster.broadcastEval(
      async (c, ctx) => {
        const server = c.guilds.cache.get(ctx.connection.serverId);
        if (server) {
          const channel = await server.channels
            .fetch(ctx.connection.channelId)
            .catch(() => null);
          return { serverName: server.name, channelName: channel?.name };
        }
        return null;
      },
      { context: { connection: connection.data } },
    );

    return resolveEval(evalArr) ?? null;
  }

  private async getConnectionFieldsForPagination(
    connections: ConnectionManager[],
    client: Client,
    locale: supportedLocaleCodes,
    startIndex: number,
  ): Promise<{ name: string; value: string }[]> {
    return await Promise.all(
      connections.map(async (connection, index) => {
        const displayData = await this.fetchConnectionDisplayData(
          client,
          connection,
        );
        const value = t('hub.servers.connectionInfo', locale, {
          serverId: connection.data.serverId,
          channelName: `${displayData?.channelName ?? 'Unknown Channel'}`,
          channelId: connection.channelId,
          joinedAt: `<t:${Math.round(connection.data.createdAt.getTime() / 1000)}:d>`,
          invite: connection.data.invite ?? 'Not Set.',
          connected: connection.connected ? 'Yes' : 'No',
        });
        return {
          name: `${startIndex + index}. ${displayData?.serverName ?? 'Unknown Server'}`,
          value,
        };
      }),
    );
  }

  async execute(ctx: Context): Promise<void> {
    await ctx.deferReply();

    const hubName = ctx.options.getString('hub', true);
    const serverId = ctx.options.getString('server');
    const client = ctx.client;
    const locale = await fetchUserLocale(ctx.user.id);

    const hub = (await this.hubService.findHubsByName(hubName)).at(0);
    if (!hub) {
      await ctx.replyEmbed(
        t('hub.notFound', locale, { emoji: ctx.getEmoji('x_icon') }),
      );
      return;
    }

    if (!(await hub.isMod(ctx.user.id))) {
      await ctx.replyEmbed(
        t('hub.notFound_mod', locale, { emoji: ctx.getEmoji('x_icon') }),
      );
      return;
    }

    const connections = await hub.connections.fetch();
    if (connections.length === 0) {
      await ctx.replyEmbed(
        t('hub.servers.noConnections', locale, {
          emoji: ctx.getEmoji('x_icon'),
        }),
      );
      return;
    }

    if (serverId) {
      const connection = connections.find(
        (con) => con.data.serverId === serverId,
      );
      if (!connection) {
        await ctx.replyEmbed(
          t('hub.servers.notConnected', locale, {
            hub: hub.data.name,
            emoji: ctx.getEmoji('x_icon'),
          }),
        );
        return;
      }
      const server = await client.guilds.fetch(serverId).catch(() => null);
      const channel = await server?.channels
        .fetch(connection.channelId)
        .catch(() => null);
      const embed = this.getConnectionInfoEmbed(
        locale,
        connection,
        server,
        channel ?? null,
      );
      await ctx.editReply({ embeds: [embed] });
      return;
    }

    const paginator = new Pagination(client);
    const itemsPerPage = 5;
    const totalConnections = connections.length;

    for (let i = 0; i < totalConnections; i += itemsPerPage) {
      const currentConnections = connections.slice(i, i + itemsPerPage);
      const startIndex = i + 1;
      const endIndex = Math.min(i + itemsPerPage, totalConnections);

      const fields = await this.getConnectionFieldsForPagination(
        currentConnections,
        client,
        locale,
        startIndex,
      );

      paginator.addPage({
        embeds: [
          new EmbedBuilder()
            .setDescription(
              t('hub.servers.total', locale, {
                from: `${startIndex}`,
                to: `${endIndex}`,
                total: `${totalConnections}`,
              }),
            )
            .setColor(Constants.Colors.primary)
            .setFields(fields),
        ],
      });
    }

    await paginator.run(ctx);
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focusedValue = escapeRegexChars(interaction.options.getFocused());
    const hubChoices = await HubCommand.getModeratedHubs(
      focusedValue,
      interaction.user.id,
      this.hubService,
    );

    await interaction.respond(
      hubChoices.map((hub) => ({
        name: hub.data.name,
        value: hub.data.name,
      })),
    );
  }
}
