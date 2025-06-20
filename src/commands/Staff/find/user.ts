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
import { HubService } from '#src/services/HubService.js';
import Constants from '#utils/Constants.js';
import db from '#utils/Db.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { stripIndents } from 'common-tags';
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  EmbedBuilder,
} from 'discord.js';

export default class FindUserSubcommand extends BaseCommand {
  constructor() {
    super({
      name: 'user',
      description: 'Get information on a user on discord.',
      staffOnly: true,
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'user',
          description: 'The username (if they\'ve used the bot within 24h) or user ID',
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
    const userId = ctx.options.getString('user', true);
    const user = await ctx.client.users.fetch(userId).catch(() => null);
    if (!user) {
      const embed = new InfoEmbed().setDescription(
        `${ctx.getEmoji('x_icon')} Unknown user. Try using user\`s ID instead if you used username.`,
      );
      await ctx.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return;
    }

    const banManager = new BanManager();
    const banned = await banManager.isUserBanned(user.id);
    const blacklistList = await db.infraction.findMany({
      where: { userId: user.id, status: 'ACTIVE', type: 'BLACKLIST' },
      select: { hub: { select: { name: true } } },
    });

    const blacklistedFromStr =
      blacklistList && blacklistList.length > 0
        ? blacklistList.map((bl) => bl.hub.name).join(', ')
        : 'None';

    const serversOwned = user.client.guilds.cache
      .filter((guild) => guild.ownerId === user.id)
      .map((guild) => guild.name);

    const ownedHubs = await new HubService().getOwnedHubs(user.id);
    const numServersOwned = serversOwned.length > 0 ? serversOwned.join(', ') : 'None';
    const numHubOwned =
      ownedHubs.length > 0 ? ownedHubs.map((hub) => hub.data.name).join(', ') : 'None';

    const embed = new EmbedBuilder()
      .setAuthor({ name: user.username, iconURL: user.avatarURL()?.toString() })
      .setColor(Constants.Colors.invisible)
      .setImage(user.bannerURL({ size: 1024 }) || null)
      .setThumbnail(user.avatarURL())
      .addFields([
        {
          name: 'User',
          value: stripIndents`
            > ${ctx.getEmoji('id')} **ID:** ${user.id}
            > ${ctx.getEmoji('mention')} **Username:** ${user.username}
            > ${ctx.getEmoji('members')} **Created:** <t:${Math.round(user.createdTimestamp / 1000)}:R>
            > ${ctx.getEmoji('bot')} **Bot:** ${user.bot}
            > ${ctx.getEmoji('owner')} **Servers Owned:** ${numServersOwned}
            `,
        },
        {
          name: 'Network',
          value: stripIndents`
            > ${ctx.getEmoji('chat_icon')} **Hubs Owned:** ${numHubOwned}
            > ${ctx.getEmoji('delete')} **Blacklisted From:** ${blacklistedFromStr}
            > ${ctx.getEmoji('delete_icon')} **Banned:** ${banned.isBanned ? 'Yes' : 'No'}
             `,
        },
      ]);

    await ctx.reply({
      content: user.id,
      embeds: [embed],
      flags: hideResponse ? ['Ephemeral'] : [],
    });
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    const users = interaction.client.users.cache;
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const filtered = users
      .filter(
        (choice) =>
          choice.username.toLowerCase().includes(focusedValue) ||
          choice.id.toLowerCase().includes(focusedValue),
      )
      .map((user) => ({ name: user.username, value: user.id }))
      .slice(0, 25);

    await interaction.respond(filtered);
  }
}
