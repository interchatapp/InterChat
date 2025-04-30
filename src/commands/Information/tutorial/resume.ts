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

export default class ResumeCommand extends BaseTutorialCommand {
  constructor() {
    super({
      name: 'resume',
      description: 'Resume your last tutorial',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context): Promise<void> {
    const userProgress = await this.tutorialService.getUserTutorials(ctx.user.id);

    // Find the most recent in-progress tutorial
    const inProgressTutorials = userProgress.filter((p) => !p.completed);

    if (inProgressTutorials.length === 0) {
      await this.handleNoTutorialsInProgress(ctx);
      return;
    }

    // Sort by most recently started
    inProgressTutorials.sort((a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );

    const mostRecent = inProgressTutorials[0];
    const tutorialManager = this.getTutorialManager(ctx.client);
    await tutorialManager.resumeTutorial(ctx, mostRecent.tutorialId);
  }
}
