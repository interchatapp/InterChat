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

import { stripIndents } from 'common-tags';
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  EmbedBuilder,
  GuildPremiumTier,
} from 'discord.js';
import Constants from '#utils/Constants.js';
import db from '#utils/Db.js';
import { toTitleCase } from '#utils/Utils.js';
import type Context from '#src/core/CommandContext/Context.js';
import BaseCommand from '#src/core/BaseCommand.js';

export default class Server extends BaseCommand {
  constructor() {
    super({
      name: 'server',
      description: 'Get information on a server that InterChat has access to.',
      staffOnly: true,
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'server',
          description: 'The server name or ID.',
          required: true,
          autocomplete: true,
        },
        {
          type: ApplicationCommandOptionType.Boolean,
          name: 'hidden',
          description: 'The response will be hidden for others. (Default: True)',
        },
      ],
    });
  }
  async execute(ctx: Context): Promise<void> {
    const hideResponse = ctx.options.getBoolean('hidden') ?? true;
    await ctx.deferReply({ flags: hideResponse ? ['Ephemeral'] : undefined });

    const serverId = ctx.options.getString('server', true);
    const guild = await ctx.client.guilds.fetch(serverId).catch(() => null);
    if (!guild) {
      await ctx.editOrReply('Unknown Server.');
      return;
    }

    const owner = await guild?.fetchOwner();

    const guildInDb = await db.connection.findMany({
      where: { serverId: guild.id },
      include: { hub: true },
    });

    const guildBlacklisted = await db.infraction.count({
      where: { expiresAt: { gt: new Date() }, serverId: guild.id },
    });
    const guildBoostLevel = GuildPremiumTier[guild.premiumTier];

    const guildHubs =
      guildInDb.length > 0 ? guildInDb.map(({ hub }) => hub?.name).join(', ') : 'None';
    const guildConnections = guildInDb?.map(({ channelId }) => `<#${channelId}> (${channelId})`);

    const embed = new EmbedBuilder()
      .setAuthor({
        name: `${guild.name}`,
        iconURL: guild.iconURL() || undefined,
      })
      .setDescription(guild.description || 'No Description')
      .setColor(Constants.Colors.invisible)
      .setThumbnail(guild.iconURL() || null)
      .setImage(guild.bannerURL({ size: 1024 }) || null)
      .addFields([
        {
          name: 'Server Info',
          value: stripIndents`
          > **Server ID:** ${guild.id}
          > **Owner:** @${owner.user.username} (${owner.id})
          > **Created:** <t:${Math.round(guild.createdTimestamp / 1000)}:R>
          > **Language:** ${guild.preferredLocale}
          > **Boost Level:** ${guildBoostLevel}
          > **Member Count:** ${guild.memberCount}
          > **On Shard:** ${guild.shardId}
          `,
        },

        {
          name: 'Server Features:',
          value:
            guild.features
              .map((feat) => `> ${toTitleCase(feat.replaceAll('_', ' '))}\n`)
              .join('') || `> ${ctx.getEmoji('x_icon')} No Features Enabled`,
        },

        {
          name: 'Network Info',
          value: stripIndents`
          > **Joined Hubs(${guildInDb.length}):** ${guildHubs}
          > **Blacklisted from:** ${guildBlacklisted} hubs
          > **Channel(s):** ${guildConnections}`,
        },
      ]);

    await ctx.editOrReply({
      content: guild?.id,
      embeds: [embed],
    });
  }
  async autocomplete(interaction: AutocompleteInteraction) {
    const guilds = interaction.client.guilds.cache;
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const choices = guilds.map((guild) => ({
      name: guild.name,
      value: guild.id,
    }));

    const filtered = choices
      .filter(
        (choice) =>
          choice.name.toLowerCase().includes(focusedValue) ||
          choice.value.toLowerCase().includes(focusedValue),
      )
      .slice(0, 25);

    await interaction.respond(filtered);
  }
}
