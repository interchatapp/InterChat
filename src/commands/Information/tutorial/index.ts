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

import ListCommand from '#src/commands/Information/tutorial/list.js';
import ResumeCommand from '#src/commands/Information/tutorial/resume.js';
import SetupCommand from '#src/commands/Information/tutorial/setup.js';
import StartCommand from '#src/commands/Information/tutorial/start.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import BaseTutorialCommand from '#src/modules/BaseCommands/BaseTutorialCommand.js';
import { MessageFlags } from 'discord.js';

export default class TutorialCommand extends BaseTutorialCommand {
  constructor() {
    super({
      name: 'tutorial',
      description: '📚 Learn how to use InterChat with interactive tutorials',
      types: { slash: true, prefix: true },
      subcommands: {
        list: new ListCommand(),
        start: new StartCommand(),
        resume: new ResumeCommand(),
        setup: new SetupCommand(),
      },
    });
  }

  @RegisterInteractionHandler('tutorial', 'start')
  async handleStartButton(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const [tutorialId] = ctx.customId.args;

    const tutorialManager = this.getTutorialManager(ctx.client);
    await tutorialManager.startTutorial(ctx, tutorialId);
  }

  @RegisterInteractionHandler('tutorial', 'resume')
  async handleResumeButton(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const [tutorialId] = ctx.customId.args;

    const tutorialManager = this.getTutorialManager(ctx.client);
    await tutorialManager.resumeTutorial(ctx, tutorialId);
  }

  @RegisterInteractionHandler('tutorial', 'list')
  async handleListButton(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const tutorialManager = this.getTutorialManager(ctx.client);
    const { container, actionRow } = await tutorialManager.createTutorialListContainer(
      ctx,
      0,
    );

    await ctx.editReply({
      components: [container, ...(actionRow ? [actionRow] : [])],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('tutorial', 'page')
  async handlePageButton(ctx: ComponentContext): Promise<void> {
    const tutorialManager = this.getTutorialManager(ctx.client);
    await tutorialManager.handlePageButton(ctx);
  }

  @RegisterInteractionHandler('tutorial', 'review')
  async handleReviewButton(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const tutorialId = ctx.customId.args[0];

    const tutorialManager = this.getTutorialManager(ctx.client);
    await tutorialManager.reviewTutorial(ctx, tutorialId, 0);
  }

  @RegisterInteractionHandler('tutorial', 'review-prev')
  async handleReviewPrevButton(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const [tutorialId, currentStepStr] = ctx.customId.args;
    const currentStep = parseInt(currentStepStr, 10);

    const tutorialManager = this.getTutorialManager(ctx.client);
    await tutorialManager.reviewTutorial(ctx, tutorialId, currentStep - 1);
  }

  @RegisterInteractionHandler('tutorial', 'review-next')
  async handleReviewNextButton(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const [tutorialId, currentStepStr] = ctx.customId.args;
    const currentStep = parseInt(currentStepStr, 10);

    const tutorialManager = this.getTutorialManager(ctx.client);
    await tutorialManager.reviewTutorial(ctx, tutorialId, currentStep + 1);
  }

  @RegisterInteractionHandler('tutorial', 'next')
  async handleNextButton(ctx: ComponentContext): Promise<void> {
    // Note: We don't need to call deferUpdate() here because it's already called in the handler
    const tutorialManager = this.getTutorialManager(ctx.client);
    await tutorialManager.handleNextButton(ctx);
  }

  @RegisterInteractionHandler('tutorial', 'prev')
  async handlePrevButton(ctx: ComponentContext): Promise<void> {
    // Note: We don't need to call deferUpdate() here because it's already called in the handler
    const tutorialManager = this.getTutorialManager(ctx.client);
    await tutorialManager.handlePrevButton(ctx);
  }

  @RegisterInteractionHandler('tutorial', 'skip')
  async handleSkipButton(ctx: ComponentContext): Promise<void> {
    // Note: We don't need to call deferUpdate() here because it's already called in the handler
    const tutorialManager = this.getTutorialManager(ctx.client);
    await tutorialManager.handleSkipButton(ctx);
  }
}
