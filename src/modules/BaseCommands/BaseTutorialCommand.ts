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

import BaseCommand, { CommandConfig } from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import { TutorialManager } from '#src/managers/tutorial/index.js';
import TutorialService from '#src/services/TutorialService.js';
import type { Client } from 'discord.js';

/**
 * Base class for all tutorial-related commands
 * Provides shared functionality and services
 */
export default abstract class BaseTutorialCommand extends BaseCommand {
  protected readonly tutorialService: TutorialService;

  constructor(options: CommandConfig) {
    super(options);
    this.tutorialService = new TutorialService();
  }

  /**
   * Get a TutorialManager instance
   * @param client Discord client
   * @returns TutorialManager instance
   */
  protected getTutorialManager(client: Client<true>): TutorialManager {
    return new TutorialManager(client);
  }

  /**
   * Handle tutorial not found error
   * @param ctx Command context
   * @param tutorialName Optional tutorial name for more specific error
   * @returns Promise<void>
   */
  protected async handleTutorialNotFound(ctx: Context, tutorialName?: string): Promise<void> {
    const message = tutorialName
      ? `${ctx.getEmoji('x_icon')} Tutorial "${tutorialName}" not found. Please try \`/tutorial list\` to see available tutorials.`
      : `${ctx.getEmoji('x_icon')} Tutorial not found. Please try \`/tutorial list\` to see available tutorials.`;

    await ctx.reply({
      content: message,
      flags: ['Ephemeral'],
    });
  }

  /**
   * Handle no tutorials in progress error
   * @param ctx Command context
   * @returns Promise<void>
   */
  protected async handleNoTutorialsInProgress(ctx: Context): Promise<void> {
    await ctx.reply({
      content: `${ctx.getEmoji('info')} You don't have any tutorials in progress. Use \`/tutorial list\` to see available tutorials.`,
      flags: ['Ephemeral'],
    });
  }
}
