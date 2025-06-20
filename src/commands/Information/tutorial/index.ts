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
import Constants from '#src/utils/Constants.js';

export default class TutorialCommand extends BaseCommand {
  constructor() {
    super({
      name: 'tutorial',
      description: '📚 Learn how to use InterChat.',
      types: { slash: true, prefix: true },
    });
  }
  async execute(ctx: Context): Promise<void> {
    await ctx.reply(
      `Welcome! Please check the tutorials available in our [guide/wiki](${Constants.Links.Website}/docs).`,
    );
  }
}
