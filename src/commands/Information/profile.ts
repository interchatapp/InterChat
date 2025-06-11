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
import Context from '#src/core/CommandContext/Context.js';
import { t } from '#src/utils/Locale.js';
import { buildProfileEmbed } from '#src/utils/ProfileUtils.js';
import { ApplicationCommandOptionType } from 'discord.js';

export default class ProfileCommand extends BaseCommand {
  constructor() {
    super({
      name: 'profile',
      description: 'View your profile or someone else\'s InterChat profile.',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'The user to view the profile of.',
          required: false,
        },
      ],
    });
  }
  async execute(ctx: Context) {
    const user = (await ctx.options.getUser('user')) ?? ctx.user;

    const profileEmbed = await buildProfileEmbed(user, ctx.client);
    if (!profileEmbed) {
      const locale = await ctx.getLocale();
      await ctx.reply(t('profile.errors.userNotFound', locale));
      return;
    }

    await ctx.reply({ embeds: [profileEmbed] });
  }
}
