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
import BaseTutorialCommand from '#src/modules/BaseCommands/BaseTutorialCommand.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { CustomID } from '#src/utils/CustomID.js';
import { ButtonInteraction, MessageFlags } from 'discord.js';

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
  async handleStartButton(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [tutorialId] = customId.args;

    const tutorialManager = this.getTutorialManager(interaction.client);
    await tutorialManager.startTutorial(interaction, tutorialId);
  }

  @RegisterInteractionHandler('tutorial', 'resume')
  async handleResumeButton(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [tutorialId] = customId.args;

    const tutorialManager = this.getTutorialManager(interaction.client);
    await tutorialManager.resumeTutorial(interaction, tutorialId);
  }

  @RegisterInteractionHandler('tutorial', 'list')
  async handleListButton(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();

    const tutorialManager = this.getTutorialManager(interaction.client);
    const { container, actionRow } = await tutorialManager.createTutorialListContainer(
      interaction,
      0,
    );

    await interaction.editReply({
      components: [container, ...(actionRow ? [actionRow] : [])],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('tutorial', 'page')
  async handlePageButton(interaction: ButtonInteraction): Promise<void> {
    const tutorialManager = this.getTutorialManager(interaction.client);
    await tutorialManager.handlePageButton(interaction);
  }

  @RegisterInteractionHandler('tutorial', 'review')
  async handleReviewButton(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const tutorialId = customId.args[0];

    const tutorialManager = this.getTutorialManager(interaction.client);
    await tutorialManager.reviewTutorial(interaction, tutorialId, 0);
  }

  @RegisterInteractionHandler('tutorial', 'review-prev')
  async handleReviewPrevButton(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [tutorialId, currentStepStr] = customId.args;
    const currentStep = parseInt(currentStepStr, 10);

    const tutorialManager = this.getTutorialManager(interaction.client);
    await tutorialManager.reviewTutorial(interaction, tutorialId, currentStep - 1);
  }

  @RegisterInteractionHandler('tutorial', 'review-next')
  async handleReviewNextButton(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [tutorialId, currentStepStr] = customId.args;
    const currentStep = parseInt(currentStepStr, 10);

    const tutorialManager = this.getTutorialManager(interaction.client);
    await tutorialManager.reviewTutorial(interaction, tutorialId, currentStep + 1);
  }

  @RegisterInteractionHandler('tutorial', 'next')
  async handleNextButton(interaction: ButtonInteraction): Promise<void> {
    // Note: We don't need to call deferUpdate() here because it's already called in the handler
    const tutorialManager = this.getTutorialManager(interaction.client);
    await tutorialManager.handleNextButton(interaction);
  }

  @RegisterInteractionHandler('tutorial', 'prev')
  async handlePrevButton(interaction: ButtonInteraction): Promise<void> {
    // Note: We don't need to call deferUpdate() here because it's already called in the handler
    const tutorialManager = this.getTutorialManager(interaction.client);
    await tutorialManager.handlePrevButton(interaction);
  }

  @RegisterInteractionHandler('tutorial', 'skip')
  async handleSkipButton(interaction: ButtonInteraction): Promise<void> {
    // Note: We don't need to call deferUpdate() here because it's already called in the handler
    const tutorialManager = this.getTutorialManager(interaction.client);
    await tutorialManager.handleSkipButton(interaction);
  }
}
