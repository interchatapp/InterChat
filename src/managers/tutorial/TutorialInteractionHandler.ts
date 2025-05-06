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

import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import TutorialService from '#src/services/TutorialService.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import {
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
  type Client,
} from 'discord.js';
import { TutorialListBuilder } from './TutorialListBuilder.js';
import { TutorialUIBuilder } from './TutorialUIBuilder.js';

/**
 * Handles ctxs with tutorial UI components
 */
export class TutorialInteractionHandler {
  private readonly tutorialService: TutorialService;
  private readonly uiBuilder: TutorialUIBuilder;
  private readonly listBuilder: TutorialListBuilder;

  constructor(client: Client<true>) {
    this.tutorialService = new TutorialService();
    this.uiBuilder = new TutorialUIBuilder(client);
    this.listBuilder = new TutorialListBuilder(client, this.tutorialService);
  }

  /**
   * Handle the "next" button in a tutorial
   */
  public async handleNextButton(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const [tutorialId, currentIndexStr] = ctx.customId.args;
    const currentIndex = parseInt(currentIndexStr, 10);

    const tutorial = await this.tutorialService.getTutorialById(tutorialId);
    if (!tutorial) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Tutorial not found.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const steps = await this.tutorialService.getTutorialSteps(tutorialId);
    const nextIndex = currentIndex + 1;

    // If we're at the last step, complete the tutorial
    if (nextIndex >= steps.length) {
      await this.tutorialService.completeTutorial(ctx.user.id, tutorialId);
      const nextTutorial = await this.tutorialService.getNextRecommendedTutorial(
        ctx.user.id,
      );
      const container = await this.uiBuilder.createCompletionContainer(tutorial, nextTutorial);

      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    // Update progress and show next step
    await this.tutorialService.updateProgress(ctx.user.id, tutorialId, {
      currentStepIndex: nextIndex,
    });

    const container = this.uiBuilder.createStepContainer(
      tutorial,
      steps[nextIndex],
      nextIndex,
      steps.length,
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Handle the "previous" button in a tutorial
   */
  public async handlePrevButton(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const [tutorialId, currentIndexStr] = ctx.customId.args;
    const currentIndex = parseInt(currentIndexStr, 10);

    const tutorial = await this.tutorialService.getTutorialById(tutorialId);
    if (!tutorial) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Tutorial not found.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const steps = await this.tutorialService.getTutorialSteps(tutorialId);
    const prevIndex = Math.max(0, currentIndex - 1);

    // Update progress and show previous step
    await this.tutorialService.updateProgress(ctx.user.id, tutorialId, {
      currentStepIndex: prevIndex,
    });

    const container = this.uiBuilder.createStepContainer(
      tutorial,
      steps[prevIndex],
      prevIndex,
      steps.length,
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Handle the "skip" button in a tutorial
   */
  public async handleSkipButton(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const textComponent = new TextDisplayBuilder().setContent(
      `## ${getEmoji('tick_icon', ctx.client)} Tutorial skipped.\nYou can resume it later with \`/tutorial resume\`.`,
    );
    const container = new ContainerBuilder().addTextDisplayComponents(textComponent);

    await ctx.editReply({
      components: [container],
    });
  }

  /**
   * Handle the page navigation button in the tutorial list
   */
  public async handlePageButton(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const pageStr = ctx.customId.args[0];
    const page = parseInt(pageStr, 10);

    const { container, actionRow } = await this.listBuilder.createTutorialListView(
      ctx,
      page,
    );

    await ctx.editReply({
      components: [container, actionRow],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Handle the "review-next" button in tutorial review mode
   */
  public async handleReviewNextButton(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const [tutorialId, currentIndexStr] = ctx.customId.args;
    const currentIndex = parseInt(currentIndexStr, 10);
    const nextIndex = currentIndex + 1;

    await this.showReviewStep(ctx, tutorialId, nextIndex);
  }

  /**
   * Handle the "review-prev" button in tutorial review mode
   */
  public async handleReviewPrevButton(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const [tutorialId, currentIndexStr] = ctx.customId.args;
    const currentIndex = parseInt(currentIndexStr, 10);
    const prevIndex = Math.max(0, currentIndex - 1);

    await this.showReviewStep(ctx, tutorialId, prevIndex);
  }

  /**
   * Show a specific step in review mode
   */
  private async showReviewStep(
    ctx: ComponentContext,
    tutorialId: string,
    stepIndex: number,
  ): Promise<void> {
    const tutorial = await this.tutorialService.getTutorialById(tutorialId);
    if (!tutorial) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Tutorial not found.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const steps = await this.tutorialService.getTutorialSteps(tutorialId);
    if (steps.length === 0) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} This tutorial has no steps.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Ensure step index is valid
    const validStepIndex = Math.max(0, Math.min(stepIndex, steps.length - 1));
    const currentStep = steps[validStepIndex];

    // Create a container for the current step
    const container = this.uiBuilder.createReviewContainer(
      tutorial,
      currentStep,
      validStepIndex,
      steps.length,
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }
}
