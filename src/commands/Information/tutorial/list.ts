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

import type Context from '#src/core/CommandContext/Context.js';
import BaseTutorialCommand from '#src/modules/BaseCommands/BaseTutorialCommand.js';
import { MessageFlags } from 'discord.js';

export default class ListCommand extends BaseTutorialCommand {
  constructor() {
    super({
      name: 'list',
      description: 'List all available tutorials',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context): Promise<void> {
    const tutorialManager = this.getTutorialManager(ctx.client);
    const { container, actionRow } = await tutorialManager.createTutorialListContainer(ctx, 0);

    await ctx.reply({
      components: [container, ...(actionRow ? [actionRow] : [])],
      flags: [MessageFlags.IsComponentsV2],
    });
  }
}
