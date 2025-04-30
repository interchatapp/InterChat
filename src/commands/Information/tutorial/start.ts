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
import { ApplicationCommandOptionType, AutocompleteInteraction } from 'discord.js';

export default class StartCommand extends BaseTutorialCommand {
  constructor() {
    super({
      name: 'start',
      description: 'Start a specific tutorial',
      types: { slash: true, prefix: true },
      options: [
        {
          name: 'tutorial',
          description: 'The tutorial to start',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true,
        },
      ],
    });
  }

  async execute(ctx: Context): Promise<void> {
    const tutorialId = ctx.options.getString('tutorial', true);
    const tutorialManager = this.getTutorialManager(ctx.client);
    await tutorialManager.startTutorial(ctx, tutorialId);
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === 'tutorial') {
      const tutorials = await this.tutorialService.getAllTutorials();
      const userProgress = await this.tutorialService.getUserTutorials(interaction.user.id);

      const choices = tutorials.map((tutorial) => {
        const progress = userProgress.find((p) => p.tutorialId === tutorial.id);
        let prefix = '';

        if (progress?.completed) {
          prefix = '✅ ';
        }
        else if (progress) {
          prefix = '▶️ ';
        }

        return {
          name: `${prefix}${tutorial.name} (${tutorial.estimatedTimeMinutes} min)`,
          value: tutorial.id,
        };
      });

      const filtered = choices.filter((choice) =>
        choice.name.toLowerCase().includes(focusedOption.value.toLowerCase()),
      );

      await interaction.respond(filtered.slice(0, 25));
    }
  }
}
