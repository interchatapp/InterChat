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
import TutorialService from '#src/services/TutorialService.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import {
  ButtonInteraction,
  MessageFlags,
  ModalSubmitInteraction,
  RepliableInteraction,
  type Client,
  type InteractionResponse,
  type Message,
} from 'discord.js';
import { TutorialInteractionHandler } from './TutorialInteractionHandler.js';
import { TutorialListBuilder } from './TutorialListBuilder.js';
import { TutorialUIBuilder } from './TutorialUIBuilder.js';

/**
 * Main manager class for tutorials
 */
export class TutorialManager {
  private readonly tutorialService: TutorialService;
  private readonly uiBuilder: TutorialUIBuilder;
  private readonly interactionHandler: TutorialInteractionHandler;
  private readonly listBuilder: TutorialListBuilder;
  private readonly client: Client<true>;

  constructor(client: Client<true>) {
    this.client = client;
    this.tutorialService = new TutorialService();
    this.uiBuilder = new TutorialUIBuilder(client);
    this.interactionHandler = new TutorialInteractionHandler(client);
    this.listBuilder = new TutorialListBuilder(client, this.tutorialService);
  }

  /**
   * Start a tutorial for a user
   */
  public async startTutorial(
    interaction: RepliableInteraction | ModalSubmitInteraction | Context,
    tutorialId: string,
  ): Promise<InteractionResponse | Message | null> {
    const tutorial = await this.tutorialService.getTutorialById(tutorialId);

    if (!tutorial) {
      if (interaction instanceof ButtonInteraction) {
        return await interaction.followUp({
          content: `${getEmoji('x_icon', interaction.client)} Tutorial not found.`,
          ephemeral: true,
        });
      }
      else {
        return await interaction.reply({
          content: `${getEmoji('x_icon', interaction.client)} Tutorial not found.`,
          flags: ['Ephemeral'],
        });
      }
    }

    // Check prerequisites
    const hasPrereqs = await this.tutorialService.hasCompletedPrerequisites(
      interaction.user.id,
      tutorialId,
    );

    if (!hasPrereqs) {
      if (interaction instanceof ButtonInteraction) {
        return await interaction.followUp({
          content: `${getEmoji('x_icon', interaction.client)} You need to complete the prerequisite tutorials first.`,
          ephemeral: true,
        });
      }
      else {
        return await interaction.reply({
          content: `${getEmoji('x_icon', interaction.client)} You need to complete the prerequisite tutorials first.`,
          flags: ['Ephemeral'],
        });
      }
    }

    // Start or resume the tutorial
    const progress = await this.tutorialService.startTutorial(interaction.user.id, tutorialId);

    // Show the first step
    return await this.showTutorialStep(interaction, tutorial.id, progress.currentStepIndex);
  }

  /**
   * Resume a tutorial for a user
   */
  public async resumeTutorial(
    interaction: RepliableInteraction | ModalSubmitInteraction | Context,
    tutorialId: string,
  ): Promise<InteractionResponse | Message | null> {
    const tutorial = await this.tutorialService.getTutorialById(tutorialId);

    if (!tutorial) {
      if (interaction instanceof ButtonInteraction) {
        return await interaction.followUp({
          content: `${getEmoji('x_icon', interaction.client)} Tutorial not found.`,
          ephemeral: true,
        });
      }
      else {
        return await interaction.reply({
          content: `${getEmoji('x_icon', interaction.client)} Tutorial not found.`,
          flags: ['Ephemeral'],
        });
      }
    }

    // Get user's progress
    const progress = await this.tutorialService.getUserProgress(interaction.user.id, tutorialId);

    if (!progress) {
      return await this.startTutorial(interaction, tutorialId);
    }

    // Show the current step
    return await this.showTutorialStep(interaction, tutorialId, progress.currentStepIndex);
  }

  /**
   * Show a specific step of a tutorial
   */
  private async showTutorialStep(
    interaction: RepliableInteraction | ModalSubmitInteraction | Context,
    tutorialId: string,
    stepIndex: number,
  ): Promise<InteractionResponse | Message | null> {
    const tutorial = await this.tutorialService.getTutorialById(tutorialId);

    if (!tutorial) {
      if (interaction instanceof ButtonInteraction) {
        return await interaction.followUp({
          content: `${getEmoji('x_icon', this.client)} Tutorial not found.`,
          ephemeral: true,
        });
      }
      else {
        return await interaction.reply({
          content: `${getEmoji('x_icon', this.client)} Tutorial not found.`,
          flags: ['Ephemeral'],
        });
      }
    }

    const steps = await this.tutorialService.getTutorialSteps(tutorialId);

    if (steps.length === 0) {
      if (interaction instanceof ButtonInteraction) {
        return await interaction.followUp({
          content: `${getEmoji('x_icon', this.client)} This tutorial has no steps.`,
          ephemeral: true,
        });
      }
      else {
        return await interaction.reply({
          content: `${getEmoji('x_icon', this.client)} This tutorial has no steps.`,
          flags: ['Ephemeral'],
        });
      }
    }

    // Get user progress
    const progress = await this.tutorialService.getUserProgress(interaction.user.id, tutorialId);

    // If the tutorial is completed, show a completion message
    if (progress?.completed) {
      return await this.showTutorialCompletion(interaction, tutorialId);
    }

    // If we're past the last step, mark as completed
    if (stepIndex >= steps.length) {
      await this.tutorialService.completeTutorial(interaction.user.id, tutorialId);
      return await this.showTutorialCompletion(interaction, tutorialId);
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

    if (interaction instanceof ButtonInteraction) {
      return await interaction.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
    else {
      return await interaction.reply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  /**
   * Show tutorial completion message
   */
  private async showTutorialCompletion(
    interaction: RepliableInteraction | ModalSubmitInteraction | Context,
    tutorialId: string,
  ): Promise<InteractionResponse | Message | null> {
    const tutorial = await this.tutorialService.getTutorialById(tutorialId);

    if (!tutorial) {
      if (interaction instanceof ButtonInteraction) {
        return await interaction.followUp({
          content: `${getEmoji('x_icon', this.client)} Tutorial not found.`,
          ephemeral: true,
        });
      }
      else {
        return await interaction.reply({
          content: `${getEmoji('x_icon', this.client)} Tutorial not found.`,
          flags: ['Ephemeral'],
        });
      }
    }

    const nextTutorial = await this.tutorialService.getNextRecommendedTutorial(interaction.user.id);
    const container = await this.uiBuilder.createCompletionContainer(tutorial, nextTutorial);

    if (interaction instanceof ButtonInteraction) {
      return await interaction.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
    else {
      return await interaction.reply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  /**
   * Show the tutorial list
   */
  public async showTutorialList(
    interaction: RepliableInteraction | ModalSubmitInteraction | Context,
  ): Promise<InteractionResponse | Message | null> {
    // Use the paginated list builder
    await this.listBuilder.createPaginatedTutorialList(interaction);
    return null;
  }

  /**
   * Review a tutorial's steps without changing progress
   */
  public async reviewTutorial(
    interaction: ButtonInteraction | Context,
    tutorialId: string,
    stepIndex: number = 0,
  ): Promise<void> {
    const tutorial = await this.tutorialService.getTutorialById(tutorialId);

    if (!tutorial) {
      if (interaction instanceof ButtonInteraction) {
        await interaction.followUp({
          content: `${getEmoji('x_icon', interaction.client)} Tutorial not found.`,
          ephemeral: true,
        });
      }
      else {
        await interaction.reply({
          content: `${getEmoji('x_icon', interaction.client)} Tutorial not found.`,
          ephemeral: true,
        });
      }
      return;
    }

    // Get all steps for this tutorial
    const steps = await this.tutorialService.getTutorialSteps(tutorialId);

    if (steps.length === 0) {
      if (interaction instanceof ButtonInteraction) {
        await interaction.followUp({
          content: `${getEmoji('x_icon', interaction.client)} This tutorial has no steps.`,
          ephemeral: true,
        });
      }
      else {
        await interaction.reply({
          content: `${getEmoji('x_icon', interaction.client)} This tutorial has no steps.`,
          ephemeral: true,
        });
      }
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
    if (interaction instanceof ButtonInteraction) {
      await interaction.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
    else {
      await interaction.reply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  // Button handlers - delegate to the interaction handler
  public async handleNextButton(interaction: ButtonInteraction): Promise<void> {
    await this.interactionHandler.handleNextButton(interaction);
  }

  public async handlePrevButton(interaction: ButtonInteraction): Promise<void> {
    await this.interactionHandler.handlePrevButton(interaction);
  }

  public async handleSkipButton(interaction: ButtonInteraction): Promise<void> {
    await this.interactionHandler.handleSkipButton(interaction);
  }

  public async handlePageButton(interaction: ButtonInteraction): Promise<void> {
    await this.interactionHandler.handlePageButton(interaction);
  }

  public async handleReviewNextButton(interaction: ButtonInteraction): Promise<void> {
    await this.interactionHandler.handleReviewNextButton(interaction);
  }

  public async handleReviewPrevButton(interaction: ButtonInteraction): Promise<void> {
    await this.interactionHandler.handleReviewPrevButton(interaction);
  }

  /**
   * Create a container for the tutorial list with pagination
   * This is a wrapper around the listBuilder's createTutorialListView method
   */
  public async createTutorialListContainer(
    interaction: ButtonInteraction | Context,
    page: number = 0,
  ) {
    return await this.listBuilder.createTutorialListView(interaction, page);
  }
}
