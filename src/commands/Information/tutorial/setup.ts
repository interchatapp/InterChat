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

export default class SetupCommand extends BaseTutorialCommand {
  constructor() {
    super({
      name: 'setup',
      description: 'Start the server setup tutorial (for admins)',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context): Promise<void> {
    // Find the setup tutorial
    const setupTutorial = await this.tutorialService.getTutorialByName('Server Setup Guide');

    if (!setupTutorial) {
      await this.handleTutorialNotFound(ctx, 'Server Setup Guide');
      return;
    }

    const tutorialManager = this.getTutorialManager(ctx.client);
    await tutorialManager.startTutorial(ctx, setupTutorial.id);
  }
}
