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
import { Badges } from '#src/generated/prisma/client/index.js';
import UserDbService from '#src/services/UserDbService.js';
import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';

export default class RemoveBadgeCommand extends BaseCommand {
  private readonly userDbService: UserDbService;

  constructor() {
    super({
      name: 'remove',
      description: 'Remove a badge from a user.',
      types: { slash: true },
      options: [
        {
          name: 'user',
          description: 'The user to remove the badge from.',
          type: ApplicationCommandOptionType.User,
          required: true,
        },
        {
          name: 'badge',
          description: 'The badge to remove.',
          type: ApplicationCommandOptionType.String,
          required: true,
          choices: Object.values(Badges).map((badge) => ({
            name: badge,
            value: badge,
          })),
        },
      ],
    });
    this.userDbService = new UserDbService();
  }

  async execute(ctx: Context) {
    const user = await ctx.options.getUser('user', true);
    const badge = ctx.options.getString('badge', true) as Badges;

    const userData = await this.userDbService.getUser(user.id);

    if (!userData?.badges.includes(badge)) {
      await ctx.reply({
        content: `${ctx.getEmoji('x_icon')} This user does not have the badge **${badge}**.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    await this.userDbService.updateUser(user.id, {
      badges: {
        set: userData.badges.filter((b) => b !== badge),
      },
    });

    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTimestamp()
      .setDescription(
        `${ctx.getEmoji('tick_icon')} Successfully removed the badge **${badge}** from ${user.username}.`,
      );

    await ctx.reply({ embeds: [embed] });
  }
}
