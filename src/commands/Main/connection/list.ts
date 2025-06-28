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

import ConnectionCommand from '#src/commands/Main/connection/index.js';
import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import type { Connection, Hub } from '#src/generated/prisma/client/client.js';
import { PaginationManager } from '#src/utils/ui/PaginationManager.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import Constants from '#utils/Constants.js';
import db from '#utils/Db.js';
import { t } from '#utils/Locale.js';
import {
  type AutocompleteInteraction,
  ContainerBuilder,
  EmbedBuilder,
  type EmbedField,
  TextDisplayBuilder,
} from 'discord.js';

export default class ConnectionListSubcommand extends BaseCommand {
  constructor() {
    super({
      name: 'list',
      description: '📜 List all hubs you have joined/are connected to in this server.',
      types: { prefix: true, slash: true },
    });
  }
  async execute(ctx: Context): Promise<void> {
    const connections = await db.connection.findMany({
      where: { serverId: ctx.guild?.id },
      include: { hub: true },
    });

    const locale = await fetchUserLocale(ctx.user.id);
    if (connections.length === 0) {
      await ctx.reply(
        t('hub.joined.noJoinedHubs', locale, {
          emoji: ctx.getEmoji('x_icon'),
          hubs_link: `${Constants.Links.Website}/hubs}`,
        }),
      );
      return;
    }

    const description = t('hub.joined.joinedHubs', locale, {
      total: `${connections.length}`,
    });

    const emojis = {
      connect: ctx.getEmoji('connect'),
      disconnect: ctx.getEmoji('disconnect'),
    };

    if (connections.length <= 25) {
      const embed = this.getEmbed(
        connections.map((connection) => this.getField(connection, emojis)),
        description,
      );
      await ctx.reply({ embeds: [embed] });
      return;
    }

    // Use PaginationManager for paginated results
    const paginationManager = new PaginationManager({
      client: ctx.client,
      identifier: `connection-list-${ctx.user.id}`,
      items: connections,
      itemsPerPage: 25,
      contentGenerator: (pageIndex, itemsOnPage) => {
        const container = new ContainerBuilder();

        // Add description header
        const headerText = new TextDisplayBuilder().setContent(description);
        container.addTextDisplayComponents(headerText);

        // Create embed with connections for this page
        const fields = itemsOnPage.map((connection) => this.getField(connection, emojis));

        // Add embed as text content (convert embed to markdown-like format)
        const connectionsText = fields
          .map((field) => `**${field.name}**\n${field.value}`)
          .join('\n\n');

        const contentText = new TextDisplayBuilder().setContent(connectionsText);
        container.addTextDisplayComponents(contentText);

        return container;
      },
    });

    await paginationManager.start(ctx);
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    await ConnectionCommand.autocomplete(interaction);
  }

  private getField(
    connection: Connection & { hub: Hub | null },
    emojis: { connect: string; disconnect: string },
  ) {
    return {
      name: `${connection.hub?.name} ${connection.connected ? emojis.connect : emojis.disconnect}`,
      value: `<#${connection.channelId}>`,
      inline: true,
    };
  }

  private getEmbed(fields: EmbedField[], description: string) {
    return new EmbedBuilder()
      .setColor(Constants.Colors.primary)
      .setDescription(description)
      .addFields(fields);
  }
}
