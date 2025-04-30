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

import type { Tutorial, UserTutorialProgress } from '#src/generated/prisma/client/client.js';
import { Pagination } from '#src/modules/Pagination.js';
import TutorialService from '#src/services/TutorialService.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ContainerBuilder,
  ModalSubmitInteraction,
  RepliableInteraction,
  type Client,
} from 'discord.js';
import Context from '#src/core/CommandContext/Context.js';
import { TutorialUIBuilder } from './TutorialUIBuilder.js';

/**
 * Audience categories for tutorials
 */
interface TutorialCategory {
  id: string;
  label: string;
  tutorials: Tutorial[];
}

/**
 * Handles building and displaying the tutorial list
 */
export class TutorialListBuilder {
  private readonly client: Client<true>;
  private readonly tutorialService: TutorialService;
  private readonly uiBuilder: TutorialUIBuilder;

  // Constants for pagination
  private readonly MAX_COMPONENTS = 10;
  private readonly RESERVED_COMPONENTS = 2; // 1 for header, 1 for page indicator
  private readonly AVAILABLE_COMPONENTS: number;

  // Category labels
  private readonly AUDIENCE_LABELS: Record<string, string> = {
    'new-user': 'New User Tutorials',
    admin: 'Server Admin Tutorials',
    moderator: 'Moderator Tutorials',
    all: 'General Tutorials',
  };

  constructor(client: Client<true>, tutorialService: TutorialService) {
    this.client = client;
    this.tutorialService = tutorialService;
    this.uiBuilder = new TutorialUIBuilder(client);
    this.AVAILABLE_COMPONENTS = this.MAX_COMPONENTS - this.RESERVED_COMPONENTS;
  }

  /**
   * Create a container for the tutorial list with pagination
   */
  public async createTutorialListView(
    interaction: ButtonInteraction | Context,
    page: number = 0,
  ): Promise<{ container: ContainerBuilder; actionRow: ActionRowBuilder<ButtonBuilder> }> {
    const container = new ContainerBuilder();
    const userId = interaction.user.id;

    // Add header
    container.addTextDisplayComponents(this.uiBuilder.createListHeader());

    // Get all tutorials and user progress
    const tutorials = await this.tutorialService.getAllTutorials();
    const userProgress = await this.tutorialService.getUserTutorials(userId);

    // Check if there are no tutorials and add a message
    if (tutorials.length === 0) {
      container.addTextDisplayComponents(this.uiBuilder.createNoTutorialsMessage());
      return { container, actionRow: new ActionRowBuilder<ButtonBuilder>() };
    }

    // Group tutorials by target audience
    const categories = this.groupTutorialsByCategory(tutorials);

    // Calculate pagination details
    const paginationInfo = this.calculatePagination(categories);
    const validPage = Math.max(0, Math.min(page, paginationInfo.totalPages - 1));

    // Add tutorials for the current page
    this.addTutorialsForPage(container, categories, userProgress, validPage);

    // Add page indicator
    container.addTextDisplayComponents(
      this.uiBuilder.createPageIndicator(validPage, paginationInfo.totalPages),
    );

    // Create navigation buttons
    const actionRow = this.uiBuilder.createPaginationButtons(validPage, paginationInfo.totalPages);

    return { container, actionRow };
  }

  /**
   * Use the Pagination module to create a paginated tutorial list
   */
  public async createPaginatedTutorialList(
    interaction: ModalSubmitInteraction | RepliableInteraction | Context,
  ): Promise<void> {
    const userId = interaction.user.id;

    // Get all tutorials and user progress
    const tutorials = await this.tutorialService.getAllTutorials();
    const userProgress = await this.tutorialService.getUserTutorials(userId);

    // Check if there are no tutorials
    if (tutorials.length === 0) {
      const container = new ContainerBuilder();
      container.addTextDisplayComponents(this.uiBuilder.createListHeader());
      container.addTextDisplayComponents(this.uiBuilder.createNoTutorialsMessage());

      await interaction.reply({
        components: [container],
        flags: ['IsComponentsV2'],
      });
      return;
    }

    // Group tutorials by target audience
    const categories = this.groupTutorialsByCategory(tutorials);

    // Create paginator
    const paginator = new Pagination(this.client);

    // Calculate how many tutorials we can fit per page
    const tutorialsPerPage = 5; // Adjust based on your UI needs

    // Create pages for each category
    for (const category of categories) {
      if (category.tutorials.length === 0) continue;

      // Split category tutorials into chunks for pagination
      const chunks = this.chunkArray(category.tutorials, tutorialsPerPage);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const container = new ContainerBuilder();

        // Add header only on the first chunk of each category
        if (i === 0) {
          container.addTextDisplayComponents(this.uiBuilder.createListHeader());
          container.addTextDisplayComponents(this.uiBuilder.createCategoryHeader(category.label));
        }

        // Add tutorials for this chunk
        for (const tutorial of chunk) {
          const progress = userProgress.find((p) => p.tutorialId === tutorial.id);
          const section = this.uiBuilder.createTutorialSection(tutorial, progress);
          container.addSectionComponents(section);
        }

        // Add page to paginator
        paginator.addPage({ components: [container] });
      }
    }

    // Run the paginator
    await paginator.run(interaction, {
      idle: 300000, // 5 minutes
      isComponentsV2: true,
    });
  }

  /**
   * Group tutorials by their target audience
   */
  private groupTutorialsByCategory(tutorials: Tutorial[]): TutorialCategory[] {
    const tutorialsByCategory: Record<string, Tutorial[]> = {
      'new-user': [],
      admin: [],
      moderator: [],
      all: [],
    };

    // Group tutorials by target audience
    for (const tutorial of tutorials) {
      tutorialsByCategory[tutorial.targetAudience].push(tutorial);
    }

    // Convert to array of categories
    return Object.entries(tutorialsByCategory)
      .filter(([, _tutorials]) => _tutorials.length > 0)
      .map(([id, _tutorials]) => ({
        id,
        label: this.AUDIENCE_LABELS[id],
        tutorials: _tutorials,
      }));
  }

  /**
   * Calculate pagination information
   */
  private calculatePagination(categories: TutorialCategory[]): {
    totalComponents: number;
    totalPages: number;
  } {
    // Count total components needed for all tutorials
    let totalComponents = 0;

    for (let i = 0; i < categories.length; i++) {
      // Add header component
      totalComponents += 1;
      // Add tutorial components
      totalComponents += categories[i].tutorials.length;
      // Add divider if not the last category
      if (i < categories.length - 1) {
        totalComponents += 1;
      }
    }

    // Calculate total pages
    const totalPages = Math.ceil(totalComponents / this.AVAILABLE_COMPONENTS);

    return { totalComponents, totalPages };
  }

  /**
   * Add tutorials for the current page to the container
   */
  private addTutorialsForPage(
    container: ContainerBuilder,
    categories: TutorialCategory[],
    userProgress: UserTutorialProgress[],
    page: number,
  ): void {
    // Skip components from previous pages
    const componentsToSkip = page * this.AVAILABLE_COMPONENTS;

    // Find the starting point for this page
    let componentsUsed = 0;
    let categoryIndex = 0;
    let tutorialIndex = 0;
    let currentPageComponents = 0;

    // Skip to the correct starting point
    while (componentsUsed < componentsToSkip && categoryIndex < categories.length) {
      const category = categories[categoryIndex];

      // Skip category header
      componentsUsed++;
      if (componentsUsed >= componentsToSkip) break;

      // Skip tutorials in this category
      while (tutorialIndex < category.tutorials.length && componentsUsed < componentsToSkip) {
        tutorialIndex++;
        componentsUsed++;
        if (componentsUsed >= componentsToSkip) break;
      }

      // If we've gone through all tutorials in this category
      if (tutorialIndex >= category.tutorials.length) {
        // Skip divider if not the last category
        if (categoryIndex < categories.length - 1) {
          componentsUsed++;
          if (componentsUsed >= componentsToSkip) break;
        }

        // Move to next category
        categoryIndex++;
        tutorialIndex = 0;
      }
    }

    // Now add components for this page
    if (categoryIndex < categories.length) {
      const category = categories[categoryIndex];

      // Check if we have enough space for at least the header and one tutorial
      if (this.AVAILABLE_COMPONENTS >= 2) {
        // Add category header
        container.addTextDisplayComponents(this.uiBuilder.createCategoryHeader(category.label));
        currentPageComponents++;

        // Add tutorials for this category
        while (
          tutorialIndex < category.tutorials.length &&
          currentPageComponents < this.AVAILABLE_COMPONENTS
        ) {
          const tutorial = category.tutorials[tutorialIndex];
          const progress = userProgress.find((p) => p.tutorialId === tutorial.id);

          // Add tutorial section
          container.addSectionComponents(this.uiBuilder.createTutorialSection(tutorial, progress));

          currentPageComponents++;
          tutorialIndex++;

          // If we've reached the component limit, break
          if (currentPageComponents >= this.AVAILABLE_COMPONENTS) break;
        }

        // If we've gone through all tutorials in this category
        if (tutorialIndex >= category.tutorials.length) {
          // Add divider if not the last category and we have space
          if (
            categoryIndex < categories.length - 1 &&
            currentPageComponents < this.AVAILABLE_COMPONENTS
          ) {
            this.uiBuilder.createSeparator(container);
            currentPageComponents++;
          }

          // Move to next category
          categoryIndex++;
          tutorialIndex = 0;
        }

        // Continue adding categories until we reach the component limit
        while (
          categoryIndex < categories.length &&
          currentPageComponents < this.AVAILABLE_COMPONENTS
        ) {
          const nextCategory = categories[categoryIndex];

          // Check if we have enough space for at least the header and one tutorial
          if (currentPageComponents + 2 > this.AVAILABLE_COMPONENTS) {
            break;
          }

          // Add category header
          container.addTextDisplayComponents(
            this.uiBuilder.createCategoryHeader(nextCategory.label),
          );
          currentPageComponents++;

          // Add tutorials for this category
          tutorialIndex = 0;

          while (
            tutorialIndex < nextCategory.tutorials.length &&
            currentPageComponents < this.AVAILABLE_COMPONENTS
          ) {
            const tutorial = nextCategory.tutorials[tutorialIndex];
            const progress = userProgress.find((p) => p.tutorialId === tutorial.id);

            // Add tutorial section
            container.addSectionComponents(
              this.uiBuilder.createTutorialSection(tutorial, progress),
            );

            currentPageComponents++;
            tutorialIndex++;

            // If we've reached the component limit, break
            if (currentPageComponents >= this.AVAILABLE_COMPONENTS) break;
          }

          // If we've gone through all tutorials in this category
          if (tutorialIndex >= nextCategory.tutorials.length) {
            // Add divider if not the last category and we have space
            if (
              categoryIndex < categories.length - 1 &&
              currentPageComponents < this.AVAILABLE_COMPONENTS
            ) {
              this.uiBuilder.createSeparator(container);
              currentPageComponents++;
            }

            // Move to next category
            categoryIndex++;
          }
          else {
            // If we couldn't fit all tutorials in this category, break
            break;
          }
        }
      }
    }
  }

  /**
   * Split an array into chunks of the specified size
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}
