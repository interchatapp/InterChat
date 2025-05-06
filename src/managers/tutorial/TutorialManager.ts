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
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import TutorialService from '#src/services/TutorialService.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { MessageFlags, type Client, type InteractionResponse, type Message } from 'discord.js';
import { TutorialInteractionHandler } from './TutorialInteractionHandler.js';
import { TutorialListBuilder } from './TutorialListBuilder.js';
import { TutorialUIBuilder } from './TutorialUIBuilder.js';

/**
 * Main manager class for tutorials
 */
export class TutorialManager {
  private readonly tutorialService: TutorialService;
  private readonly uiBuilder: TutorialUIBuilder;
  private readonly ctxHandler: TutorialInteractionHandler;
  private readonly listBuilder: TutorialListBuilder;
  private readonly client: Client<true>;

  constructor(client: Client<true>) {
    this.client = client;
    this.tutorialService = new TutorialService();
    this.uiBuilder = new TutorialUIBuilder(client);
    this.ctxHandler = new TutorialInteractionHandler(client);
    this.listBuilder = new TutorialListBuilder(client, this.tutorialService);
  }

  /**
   * Start a tutorial for a user
   */
  public async startTutorial(
    ctx: ComponentContext | Context,
    tutorialId: string,
  ): Promise<InteractionResponse | Message | null> {
    const tutorial = await this.tutorialService.getTutorialById(tutorialId);

    if (!tutorial) {
      return await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Tutorial not found.`,
        flags: ['Ephemeral'],
      });
    }

    // Check prerequisites
    const hasPrereqs = await this.tutorialService.hasCompletedPrerequisites(
      ctx.user.id,
      tutorialId,
    );

    if (!hasPrereqs) {
      return await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} You need to complete the prerequisite tutorials first.`,
        flags: ['Ephemeral'],
      });
    }

    // Start or resume the tutorial
    const progress = await this.tutorialService.startTutorial(ctx.user.id, tutorialId);

    // Show the first step
    return await this.showTutorialStep(ctx, tutorial.id, progress.currentStepIndex);
  }

  /**
   * Resume a tutorial for a user
   */
  public async resumeTutorial(
    ctx: Context | ComponentContext,
    tutorialId: string,
  ): Promise<InteractionResponse | Message | null> {
    const tutorial = await this.tutorialService.getTutorialById(tutorialId);

    if (!tutorial) {
      return await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Tutorial not found.`,
        flags: ['Ephemeral'],
      });
    }

    // Get user's progress
    const progress = await this.tutorialService.getUserProgress(ctx.user.id, tutorialId);

    if (!progress) {
      return await this.startTutorial(ctx, tutorialId);
    }

    // Show the current step
    return await this.showTutorialStep(ctx, tutorialId, progress.currentStepIndex);
  }

  /**
   * Show a specific step of a tutorial
   */
  private async showTutorialStep(
    ctx: Context | ComponentContext,
    tutorialId: string,
    stepIndex: number,
  ): Promise<InteractionResponse | Message | null> {
    const tutorial = await this.tutorialService.getTutorialById(tutorialId);

    if (!tutorial) {
      return await ctx.reply({
        content: `${getEmoji('x_icon', this.client)} Tutorial not found.`,
        flags: ['Ephemeral'],
      });
    }

    const steps = await this.tutorialService.getTutorialSteps(tutorialId);

    if (steps.length === 0) {
      return await ctx.reply({
        content: `${getEmoji('x_icon', this.client)} This tutorial has no steps.`,
        flags: ['Ephemeral'],
      });
    }

    // Get user progress
    const progress = await this.tutorialService.getUserProgress(ctx.user.id, tutorialId);

    // If the tutorial is completed, show a completion message
    if (progress?.completed) {
      return await this.showTutorialCompletion(ctx, tutorialId);
    }

    // If we're past the last step, mark as completed
    if (stepIndex >= steps.length) {
      await this.tutorialService.completeTutorial(ctx.user.id, tutorialId);
      return await this.showTutorialCompletion(ctx, tutorialId);
    }

    // Get the current step
    const currentStep = steps[stepIndex];

    // Create the UI for the step
    const container = this.uiBuilder.createStepContainer(
      tutorial,
      currentStep,
      stepIndex,
      steps.length,
    );

    return await ctx.editOrReply({ components: [container] }, ['IsComponentsV2']);
  }

  /**
   * Show tutorial completion message
   */
  private async showTutorialCompletion(
    ctx: Context | ComponentContext,
    tutorialId: string,
  ): Promise<InteractionResponse | Message | null> {
    const tutorial = await this.tutorialService.getTutorialById(tutorialId);

    if (!tutorial) {
      return await ctx.reply({
        content: `${getEmoji('x_icon', this.client)} Tutorial not found.`,
        flags: ['Ephemeral'],
      });
    }

    const nextTutorial = await this.tutorialService.getNextRecommendedTutorial(ctx.user.id);
    const container = await this.uiBuilder.createCompletionContainer(tutorial, nextTutorial);

    return await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Review a tutorial's steps without changing progress
   */
  public async reviewTutorial(
    ctx: Context | ComponentContext,
    tutorialId: string,
    stepIndex: number = 0,
  ): Promise<void> {
    const tutorial = await this.tutorialService.getTutorialById(tutorialId);

    if (!tutorial) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Tutorial not found.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Get all steps for this tutorial
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

    // Show the review container
    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  // Button handlers - delegate to the ctx handler
  public async handleNextButton(ctx: ComponentContext): Promise<void> {
    await this.ctxHandler.handleNextButton(ctx);
  }

  public async handlePrevButton(ctx: ComponentContext): Promise<void> {
    await this.ctxHandler.handlePrevButton(ctx);
  }

  public async handleSkipButton(ctx: ComponentContext): Promise<void> {
    await this.ctxHandler.handleSkipButton(ctx);
  }

  public async handlePageButton(ctx: ComponentContext): Promise<void> {
    await this.ctxHandler.handlePageButton(ctx);
  }

  public async handleReviewNextButton(ctx: ComponentContext): Promise<void> {
    await this.ctxHandler.handleReviewNextButton(ctx);
  }

  public async handleReviewPrevButton(ctx: ComponentContext): Promise<void> {
    await this.ctxHandler.handleReviewPrevButton(ctx);
  }

  /**
   * Create a container for the tutorial list with pagination
   * This is a wrapper around the listBuilder's createTutorialListView method
   */
  public async createTutorialListContainer(ctx: Context | Context, page: number = 0) {
    return await this.listBuilder.createTutorialListView(ctx, page);
  }
}
