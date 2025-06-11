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
import Constants from '#utils/Constants.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { t } from '#src/utils/Locale.js';

export default class BrowseCommand extends BaseCommand {
  constructor() {
    super({
      name: 'browse',
      description: '🔍 Browse public hubs and join them!',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context): Promise<void> {
    const locale = await fetchUserLocale(ctx.user.id);
    await ctx.reply({
      content: t('hubBrowse.content', locale, {
        website: Constants.Links.Website,
        emoji: ctx.getEmoji('wand_icon'),
      }),
      flags: ['Ephemeral'],
    });
  }
}
