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

export default class AddBadgeCommand extends BaseCommand {
  private readonly userDbService: UserDbService;

  constructor() {
    super({
      name: 'add',
      description: 'Add a badge to a user.',
      types: { slash: true },
      options: [
        {
          name: 'user',
          description: 'The user to add the badge to.',
          type: ApplicationCommandOptionType.User,
          required: true,
        },
        {
          name: 'badge',
          description: 'The badge to add.',
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

    if (!userData) {
      await ctx.reply({
        content: 'User not found in the database.',
        flags: ['Ephemeral'],
      });
      return;
    }

    if (userData.badges.includes(badge)) {
      await ctx.reply({
        content: `${ctx.getEmoji('x_icon')} This user already has the badge **${badge}**.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    await this.userDbService.updateUser(user.id, {
      badges: {
        push: badge,
      },
    });

    const embed = new EmbedBuilder()
      .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
      .setTitle(`Badge Added: ${badge}`)
      .setDescription(`The badge **${badge}** has been successfully added to ${user.username}.`);

    await ctx.reply({ embeds: [embed] });
  }
}
