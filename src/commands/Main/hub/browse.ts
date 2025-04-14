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
import { stripIndents } from 'common-tags';

export default class BrowseCommand extends BaseCommand {
  constructor() {
    super({
      name: 'browse',
      description: '🔍 Browse public hubs and join them!',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context): Promise<void> {
    await ctx.reply({
      content: stripIndents`
      ### [🔍 Use the hub-browser on the website!](${Constants.Links.Website}/hubs)
      Hey there! This command has been moved to InterChat's website: ${Constants.Links.Website}/hubs as it is much easier to use there with a better interface and more features!

      ${ctx.getEmoji('wand_icon')} **Pro tip:** Check out our full [dashboard](${Constants.Links.Website}/dashboard) to manage your hubs, view analytics, and configure settings visually!
      `,
      flags: ['Ephemeral'],
    });
  }
}
