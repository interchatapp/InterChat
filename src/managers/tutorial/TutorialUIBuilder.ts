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

import type {
  Tutorial,
  TutorialStep,
  UserTutorialProgress,
} from '#src/generated/prisma/client/client.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type Client,
} from 'discord.js';

/**
 * Responsible for building UI components for tutorials
 */
export class TutorialUIBuilder {
  private readonly client: Client<boolean>;

  constructor(client: Client<boolean>) {
    this.client = client;
  }

  /**
   * Create a Components v2 container for a tutorial step
   */
  public createStepContainer(
    tutorial: Tutorial,
    step: TutorialStep,
    currentIndex: number,
    totalSteps: number,
  ): ContainerBuilder {
    const container = new ContainerBuilder();

    // Add header
    const headerText = new TextDisplayBuilder().setContent(
      `# ${getEmoji('wand_icon', this.client)} ${tutorial.name} - Tutorial\n${tutorial.description}`,
    );
    container.addTextDisplayComponents(headerText);

    // Add progress indicator
    const progressText = new TextDisplayBuilder().setContent(
      `**Step ${currentIndex + 1} of ${totalSteps}**: ${step.title}`,
    );
    container.addTextDisplayComponents(progressText);

    // Add step description
    const stepText = new TextDisplayBuilder().setContent(step.description);
    container.addTextDisplayComponents(stepText);

    // Add navigation buttons
    const prevButton = this.createPreviousButton(tutorial.id, currentIndex);
    const nextButton = this.createNextButton(tutorial.id, currentIndex);
    const skipButton = this.createSkipButton(tutorial.id);

    // Add action button if needed
    if (step.actionType === 'button') {
      try {
        const actionData = JSON.parse(step.actionData || '{}');
        const actionButton = this.createActionButton(tutorial.id, currentIndex, actionData.label);

        container.addActionRowComponents((row) =>
          row.addComponents(prevButton, actionButton, nextButton, skipButton),
        );
      }
      catch {
        // Fallback if action data is invalid
        container.addActionRowComponents((row) =>
          row.addComponents(prevButton, nextButton, skipButton),
        );
      }
    }
    else {
      container.addActionRowComponents((row) =>
        row.addComponents(prevButton, nextButton, skipButton),
      );
    }

    return container;
  }

  /**
   * Create a completion container for a tutorial
   */
  public async createCompletionContainer(
    tutorial: Tutorial,
    nextTutorial: Tutorial | null,
  ): Promise<ContainerBuilder> {
    const container = new ContainerBuilder();

    // Add completion message
    const completionText = new TextDisplayBuilder().setContent(
      `## ${getEmoji('tick_icon', this.client)} Tutorial Completed!\nCongratulations! You've completed the "${tutorial.name}" tutorial.`,
    );
    container.addTextDisplayComponents(completionText);

    // Add next steps section if there's a next tutorial
    if (nextTutorial) {
      const nextButton = this.createStartTutorialButton(nextTutorial.id, nextTutorial.name);
      const nextSection = new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**Next Recommended Tutorial:** ${nextTutorial.name}`,
          ),
        )
        .setButtonAccessory(nextButton);

      container.addSectionComponents(nextSection);
    }

    // Add review button to allow users to review the tutorial steps
    const reviewButton = this.createReviewButton(tutorial.id);

    // Add list tutorials button
    const listButton = this.createListTutorialsButton();

    container.addActionRowComponents((row) => row.addComponents(reviewButton, listButton));

    return container;
  }

  /**
   * Create a container for the tutorial review mode
   */
  public createReviewContainer(
    tutorial: Tutorial,
    currentStep: TutorialStep,
    stepIndex: number,
    totalSteps: number,
  ): ContainerBuilder {
    const container = new ContainerBuilder();

    // Add header
    const headerText = new TextDisplayBuilder().setContent(
      `# ${getEmoji('wand_icon', this.client)} ${tutorial.name} - Review\n${tutorial.description}`,
    );
    container.addTextDisplayComponents(headerText);

    // Add progress indicator
    const progressText = new TextDisplayBuilder().setContent(
      `**Step ${stepIndex + 1} of ${totalSteps}**: ${currentStep.title}`,
    );
    container.addTextDisplayComponents(progressText);

    // Add step description
    const stepDescription = new TextDisplayBuilder().setContent(currentStep.description);
    container.addTextDisplayComponents(stepDescription);

    // Create navigation buttons
    const prevButton = this.createReviewPreviousButton(tutorial.id, stepIndex);
    const nextButton = this.createReviewNextButton(tutorial.id, stepIndex, totalSteps);
    const backButton = this.createListTutorialsButton();

    // Add navigation buttons
    container.addActionRowComponents((row) =>
      row.addComponents(prevButton, nextButton, backButton),
    );

    return container;
  }

  /**
   * Create a tutorial section for the tutorial list
   */
  public createTutorialSection(
    tutorial: Tutorial,
    progress: UserTutorialProgress | undefined,
  ): SectionBuilder {
    const isCompleted = progress?.completed || false;
    const isStarted = progress && !isCompleted;

    // Create button based on status
    let button: ButtonBuilder;
    if (isCompleted) {
      button = this.createResumeButton(tutorial.id, 'Review');
    }
    else if (isStarted) {
      button = this.createResumeButton(tutorial.id, 'Continue');
    }
    else {
      button = this.createStartTutorialButton(tutorial.id);
    }

    // Create status indicator
    let statusIndicator = '';
    if (isCompleted) {
      statusIndicator = `${getEmoji('tick_icon', this.client)} Completed`;
    }
    else if (isStarted) {
      statusIndicator = `${getEmoji('arrow_right', this.client)} In Progress`;
    }
    else {
      statusIndicator = `${getEmoji('wand_icon', this.client)} Not Started`;
    }

    // Create tutorial section
    return new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `### ${tutorial.name}\n${tutorial.description}\n**Status:** ${statusIndicator} • **Time:** ~${tutorial.estimatedTimeMinutes} min`,
        ),
      )
      .setButtonAccessory(button);
  }

  /**
   * Create a category header for the tutorial list
   */
  public createCategoryHeader(categoryLabel: string): TextDisplayBuilder {
    return new TextDisplayBuilder().setContent(`## ${categoryLabel}`);
  }

  /**
   * Create a separator for the tutorial list
   */
  public createSeparator(container: ContainerBuilder): void {
    container.addSeparatorComponents((separator) =>
      separator.setSpacing(SeparatorSpacingSize.Large),
    );
  }

  /**
   * Create a header for the tutorial list
   */
  public createListHeader(): TextDisplayBuilder {
    return new TextDisplayBuilder().setContent(
      `# ${getEmoji('wand_icon', this.client)} Welcome to InterChat Tutorials! 🎉\nReady to become an InterChat expert? These friendly, interactive tutorials will guide you through everything step by step. Let's learn together! ✨`,
    );
  }

  /**
   * Create a "no tutorials" message
   */
  public createNoTutorialsMessage(): TextDisplayBuilder {
    return new TextDisplayBuilder().setContent(
      '## 🚧 Tutorials Coming Soon!\nWe\'re working hard to create some amazing tutorials for you! Check back soon, or feel free to explore InterChat on your own - you\'ve got this! If you need help, our friendly support community is always here for you. 😊',
    );
  }

  /**
   * Create a page indicator for the tutorial list
   */
  public createPageIndicator(currentPage: number, totalPages: number): TextDisplayBuilder {
    return new TextDisplayBuilder().setContent(`Page ${currentPage + 1} of ${totalPages}`);
  }

  /**
   * Create pagination buttons for the tutorial list
   */
  public createPaginationButtons(
    currentPage: number,
    totalPages: number,
  ): ActionRowBuilder<ButtonBuilder> {
    const prevButton = new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('tutorial', 'page')
          .setArgs((currentPage - 1).toString())
          .toString(),
      )
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('arrow_left', this.client))
      .setDisabled(currentPage === 0);

    const nextButton = new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('tutorial', 'page')
          .setArgs((currentPage + 1).toString())
          .toString(),
      )
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('arrow_right', this.client))
      .setDisabled(currentPage >= totalPages - 1);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton);
  }

  // Button creation helper methods
  private createPreviousButton(tutorialId: string, currentIndex: number): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('tutorial', 'prev')
          .setArgs(tutorialId, currentIndex.toString())
          .toString(),
      )
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('arrow_left', this.client))
      .setDisabled(currentIndex === 0);
  }

  private createNextButton(tutorialId: string, currentIndex: number): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('tutorial', 'next')
          .setArgs(tutorialId, currentIndex.toString())
          .toString(),
      )
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setEmoji(getEmoji('arrow_right', this.client));
  }

  private createSkipButton(tutorialId: string): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(new CustomID().setIdentifier('tutorial', 'skip').setArgs(tutorialId).toString())
      .setLabel('Skip Tutorial')
      .setStyle(ButtonStyle.Secondary);
  }

  private createActionButton(
    tutorialId: string,
    currentIndex: number,
    label: string = 'Try it',
  ): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('tutorial', 'action')
          .setArgs(tutorialId, currentIndex.toString())
          .toString(),
      )
      .setLabel(label)
      .setStyle(ButtonStyle.Success)
      .setEmoji(getEmoji('wand_icon', this.client));
  }

  private createReviewButton(tutorialId: string): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(
        new CustomID().setIdentifier('tutorial', 'review').setArgs(tutorialId).toString(),
      )
      .setLabel('Review Steps')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('arrow_right', this.client));
  }

  private createListTutorialsButton(): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(new CustomID().setIdentifier('tutorial', 'list').toString())
      .setLabel('View All Tutorials')
      .setStyle(ButtonStyle.Secondary);
  }

  private createStartTutorialButton(
    tutorialId: string,
    tutorialName?: string,
  ): ButtonBuilder {
    const button = new ButtonBuilder()
      .setCustomId(
        new CustomID().setIdentifier('tutorial', 'start').setArgs(tutorialId).toString(),
      )
      .setStyle(ButtonStyle.Success)
      .setEmoji(getEmoji('wand_icon', this.client));

    if (tutorialName) {
      button.setLabel(`Start "${tutorialName}" Tutorial`);
    }
    else {
      button.setLabel('Start');
    }

    return button;
  }

  private createResumeButton(tutorialId: string, label: string): ButtonBuilder {
    const style = label === 'Review' ? ButtonStyle.Secondary : ButtonStyle.Primary;
    const emoji = label === 'Review'
      ? getEmoji('tick_icon', this.client)
      : getEmoji('arrow_right', this.client);

    return new ButtonBuilder()
      .setCustomId(
        new CustomID().setIdentifier('tutorial', 'resume').setArgs(tutorialId).toString(),
      )
      .setLabel(label)
      .setStyle(style)
      .setEmoji(emoji);
  }

  private createReviewPreviousButton(tutorialId: string, currentIndex: number): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('tutorial', 'review-prev')
          .setArgs(tutorialId, currentIndex.toString())
          .toString(),
      )
      .setLabel('Previous Step')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('arrow_left', this.client))
      .setDisabled(currentIndex === 0);
  }

  private createReviewNextButton(
    tutorialId: string,
    currentIndex: number,
    totalSteps: number,
  ): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('tutorial', 'review-next')
          .setArgs(tutorialId, currentIndex.toString())
          .toString(),
      )
      .setLabel('Next Step')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('arrow_right', this.client))
      .setDisabled(currentIndex >= totalSteps - 1);
  }
}
