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
import Context from '#src/core/CommandContext/Context.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Logger from '#src/utils/Logger.js';
import { getReplyMethod, handleError } from '#utils/Utils.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  type CacheType,
  type Client,
  ComponentType,
  ContainerBuilder,
  type InteractionCollector,
  type InteractionEditReplyOptions,
  type InteractionResponse,
  type InteractionReplyOptions,
  Message,
  MessageFlags,
  type RepliableInteraction,
  TextDisplayBuilder,
} from 'discord.js';

/**
 * Pagination content generator function type
 * This function is called to generate content for each page
 */
export type PageContentGenerator<T = unknown> = (
  pageIndex: number,
  itemsOnPage: T[],
  totalPages: number,
  totalItems: number,
) => ContainerBuilder;

/**
 * Configuration options for the PaginationManager
 */
export interface PaginationOptions<T = unknown> {
  /** The client instance */
  client: Client;
  /** The identifier for this pagination instance */
  identifier: string;
  /** The items to paginate */
  items: T[];
  /** Number of items per page */
  itemsPerPage?: number;
  /** Function to generate content for each page */
  contentGenerator: PageContentGenerator<T>;
  /** Whether to use ephemeral messages */
  ephemeral?: boolean;
  /** Idle timeout in milliseconds */
  idleTimeout?: number;
  /** Whether to delete the message when the pagination ends */
  deleteOnEnd?: boolean;
  /** Custom emoji keys for pagination buttons */
  customEmojis?: {
    back?: string;
    next?: string;
    select?: string;
  };
  /** Whether to hide certain buttons */
  hideButtons?: {
    back?: boolean;
    next?: boolean;
    select?: boolean;
    indicator?: boolean;
  };
}

/**
 * A general-purpose pagination utility for Discord.js Components v2
 * This class handles pagination for various types of content throughout the application
 */
export class PaginationManager<T = unknown> {
  private readonly client: Client;
  private readonly identifier: string;
  private readonly items: T[];
  private readonly itemsPerPage: number;
  private readonly contentGenerator: PageContentGenerator<T>;
  private readonly ephemeral: boolean;
  private readonly idleTimeout: number;
  private readonly deleteOnEnd: boolean;
  private readonly customEmojis: {
    back: string;
    next: string;
    select: string;
  };
  private readonly hideButtons: {
    back: boolean;
    next: boolean;
    select: boolean;
    indicator: boolean;
  };

  private currentPage = 0;
  private collector: InteractionCollector<ButtonInteraction<CacheType>> | null = null;
  private message: Message | InteractionResponse | null = null;

  /**
   * Create a new PaginationManager instance
   * @param options Configuration options
   */
  constructor(options: PaginationOptions<T>) {
    this.client = options.client;
    this.identifier = options.identifier;
    this.items = options.items;
    this.itemsPerPage = options.itemsPerPage || 5;
    this.contentGenerator = options.contentGenerator;
    this.ephemeral = options.ephemeral || false;
    this.idleTimeout = options.idleTimeout || 300000; // 5 minutes default
    this.deleteOnEnd = options.deleteOnEnd || false;

    // Set custom emojis with defaults
    this.customEmojis = {
      back: options.customEmojis?.back || getEmoji('arrow_left', this.client),
      next: options.customEmojis?.next || getEmoji('arrow_right', this.client),
      select: options.customEmojis?.select || getEmoji('hash_icon', this.client),
    };

    // Set button visibility options
    this.hideButtons = {
      back: options.hideButtons?.back || false,
      next: options.hideButtons?.next || false,
      select: options.hideButtons?.select || false,
      indicator: options.hideButtons?.indicator || false,
    };
  }

  /**
   * Get the total number of pages
   */
  public get totalPages(): number {
    return Math.ceil(this.items.length / this.itemsPerPage);
  }

  /**
   * Get the items for the current page
   */
  private getItemsForPage(pageIndex: number): T[] {
    const startIndex = pageIndex * this.itemsPerPage;
    return this.items.slice(startIndex, startIndex + this.itemsPerPage);
  }

  /**
   * Create pagination buttons for the current page
   */
  private createPaginationButtons(pageIndex: number): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();
    const buttons: ButtonBuilder[] = [];

    // Back button
    if (!this.hideButtons.back) {
      // Create a custom ID with the action as the last part
      // Use a simple format that's easy to parse: "identifier_action"
      const prevId = `${this.identifier}_prev`;
      const backButton = new ButtonBuilder()
        .setCustomId(prevId)
        .setEmoji(this.customEmojis.back)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pageIndex === 0);
      buttons.push(backButton);
      Logger.debug(`Created back button with ID: ${prevId}`);
    }

    // Page indicator
    if (!this.hideButtons.indicator) {
      // Create a custom ID with the action as the last part
      const indicatorId = `${this.identifier}_indicator`;
      const indicator = new ButtonBuilder()
        .setCustomId(indicatorId)
        .setLabel(`${pageIndex + 1}/${this.totalPages}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true);
      buttons.push(indicator);
      Logger.debug(`Created indicator button with ID: ${indicatorId}`);
    }

    // Next button
    if (!this.hideButtons.next) {
      // Create a custom ID with the action as the last part
      const nextId = `${this.identifier}_next`;
      const nextButton = new ButtonBuilder()
        .setCustomId(nextId)
        .setEmoji(this.customEmojis.next)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pageIndex >= this.totalPages - 1);
      buttons.push(nextButton);
      Logger.debug(`Created next button with ID: ${nextId}`);
    }

    // Select page button
    if (!this.hideButtons.select) {
      // Create a custom ID with the action as the last part
      const selectId = `${this.identifier}_select`;
      const selectButton = new ButtonBuilder()
        .setCustomId(selectId)
        .setEmoji(this.customEmojis.select)
        .setStyle(ButtonStyle.Secondary);
      buttons.push(selectButton);
      Logger.debug(`Created select button with ID: ${selectId}`);
    }

    return row.addComponents(...buttons);
  }

  /**
   * Generate the container for the current page
   */
  private generatePageContainer(pageIndex: number): ContainerBuilder {
    const itemsOnPage = this.getItemsForPage(pageIndex);
    return this.contentGenerator(pageIndex, itemsOnPage, this.totalPages, this.items.length);
  }

  /**
   * Start the pagination
   * @param ctx The context to reply to
   */
  public async start(ctx: Context | ComponentContext | RepliableInteraction): Promise<void> {
    // Log the pagination start
    Logger.debug(`Starting pagination with identifier: ${this.identifier}`);
    Logger.debug(`Items count: ${this.items.length}, Items per page: ${this.itemsPerPage}`);

    if (this.items.length === 0) {
      // No items to display
      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${getEmoji('tick', this.client)} No results to display!`,
        ),
      );

      await this.sendReply(ctx, container);
      return;
    }

    // Generate the first page
    this.currentPage = 0;
    const container = this.generatePageContainer(this.currentPage);

    // Add pagination buttons
    const paginationRow = this.createPaginationButtons(this.currentPage);
    container.addActionRowComponents((row) => {
      row.addComponents(...paginationRow.components);
      return row;
    });

    // Send the initial message
    Logger.debug(`Sending initial pagination message with ${this.totalPages} total pages`);
    this.message = await this.sendReply(ctx, container);
    if (!this.message) {
      Logger.error('Failed to send initial pagination message');
      return;
    }

    // Set up collector for button interactions
    await this.setupCollector(ctx);
    Logger.debug('Pagination collector set up successfully');
  }

  /**
   * Set up the collector for button interactions
   */
  private async setupCollector(
    ctx: Context | ComponentContext | RepliableInteraction,
  ): Promise<void> {
    if (!this.message) return;

    // Get the message object
    let messageObj: Message;

    if (this.message instanceof Message) {
      messageObj = this.message;
    }
    else if (ctx instanceof Context || ctx instanceof ComponentContext) {
      try {
        // For Context and ComponentContext, we need to handle different interaction types
        if ('fetchReply' in ctx.interaction) {
          messageObj = await ctx.interaction.fetchReply();
        }
        else {
          Logger.warn('Context interaction does not support fetchReply');
          return;
        }
      }
      catch (error) {
        Logger.error('Failed to fetch reply from context', error);
        return;
      }
    }
    else {
      // For RepliableInteraction
      try {
        messageObj = await ctx.fetchReply();
      }
      catch (error) {
        handleError(error);
        return;
      }
    }

    if (!messageObj) return;

    // Create collector
    this.collector = messageObj.createMessageComponentCollector({
      filter: (i) => {
        // Check if the button belongs to this paginator
        // The format is now "identifier_action" for simplicity
        const customIdParts = i.customId.split('_');

        // The action is the last part
        const action = customIdParts[customIdParts.length - 1];
        const isActionValid = ['next', 'prev', 'indicator', 'select'].includes(action);

        // The identifier is everything except the last part
        const buttonIdentifier = i.customId.substring(0, i.customId.lastIndexOf('_'));
        const belongsToPaginator = buttonIdentifier === this.identifier;

        const isCorrectUser =
          ctx instanceof Context || ctx instanceof ComponentContext
            ? i.user.id === ctx.user.id
            : i.user.id === ctx.user.id;

        Logger.debug(
          `Button filter check: ID=${i.customId}, identifier=${buttonIdentifier}, action=${action}, belongs=${belongsToPaginator}, correctUser=${isCorrectUser}, isActionValid=${isActionValid}`,
        );
        return belongsToPaginator && isCorrectUser && isActionValid;
      },
      idle: this.idleTimeout,
      componentType: ComponentType.Button,
    });

    // Handle button clicks
    this.collector?.on('collect', async (interaction: ButtonInteraction) => {
      try {
        // Log the button click for debugging
        Logger.debug(`Pagination button clicked: ${interaction.customId}`);

        await interaction.deferUpdate();

        // Parse the custom ID - the action is always the last part
        const customIdParts = interaction.customId.split('_');
        const action = customIdParts[customIdParts.length - 1];

        // Log the parsed custom ID
        Logger.debug(`Parsed CustomID - full ID: ${interaction.customId}, action: ${action}`);
        Logger.debug(`Current page: ${this.currentPage}, Total pages: ${this.totalPages}`);

        if (action === 'next' && this.currentPage < this.totalPages - 1) {
          Logger.debug(`Moving to next page: ${this.currentPage + 1}`);
          this.currentPage++;
          // Use the interaction directly for updating the page
          await this.updatePageFromInteraction(interaction);
        }
        else if (action === 'prev' && this.currentPage > 0) {
          Logger.debug(`Moving to previous page: ${this.currentPage - 1}`);
          this.currentPage--;
          // Use the interaction directly for updating the page
          await this.updatePageFromInteraction(interaction);
        }
        else if (action === 'select') {
          // TODO: Implement page selection modal
          // For now, we'll just log that it's not implemented
          Logger.debug('Page selection not implemented yet');
        }
        else {
          Logger.debug(`Unknown action: ${action} or pagination limits reached`);
        }
      }
      catch (error) {
        Logger.error('Error handling pagination button click', error);
      }
    });

    // Handle collector end
    this.collector?.on('end', async () => {
      if (!this.message) return;

      if (this.deleteOnEnd) {
        // Delete the message
        if (this.message instanceof Message) {
          await this.message.delete().catch(() => null);
        }
        else if (ctx instanceof Context || ctx instanceof ComponentContext) {
          await ctx.deleteReply().catch(() => null);
        }
      }
      else {
        try {
          // Remove the buttons but keep the content
          const container = this.generatePageContainer(this.currentPage);

          if (this.message instanceof Message) {
            await this.message
              .edit({
                components: [container],
                flags: MessageFlags.IsComponentsV2,
                // Explicitly set content to undefined to ensure it's not included
                content: undefined,
                // Explicitly set embeds to undefined to ensure they're not included
                embeds: undefined,
              })
              .catch(() => null);
          }
          else if (ctx instanceof Context || ctx instanceof ComponentContext) {
            await ctx
              .editReply({
                components: [container],
                flags: [MessageFlags.IsComponentsV2],
                // Explicitly set content to undefined to ensure it's not included
                content: undefined,
                // Explicitly set embeds to undefined to ensure they're not included
                embeds: undefined,
              })
              .catch(() => null);
          }
        }
        catch (error) {
          Logger.error('Failed to update pagination on collector end', error);
        }
      }
    });
  }

  /**
   * Update the page content from an interaction
   */
  private async updatePageFromInteraction(interaction: ButtonInteraction): Promise<void> {
    try {
      Logger.debug(`Updating page to ${this.currentPage}`);

      // Generate the new page
      const container = this.generatePageContainer(this.currentPage);

      // Log the container for debugging
      Logger.debug(`Generated container for page ${this.currentPage}`);

      // Add pagination buttons
      const paginationRow = this.createPaginationButtons(this.currentPage);
      container.addActionRowComponents((row) => {
        row.addComponents(...paginationRow.components);
        return row;
      });

      // Update the message using the interaction
      // When using Components v2, we must not include content field
      Logger.debug(
        `Interaction state: deferred=${interaction.deferred}, replied=${interaction.replied}`,
      );

      try {
        // Always use update() for button interactions
        await interaction.update({
          components: [container],
          flags: MessageFlags.IsComponentsV2,
          // Explicitly set content to undefined to ensure it's not included
          content: undefined,
          // Explicitly set embeds to undefined to ensure they're not included
          embeds: undefined,
        });
        Logger.debug(`Successfully updated page to ${this.currentPage}`);
      }
      catch (updateError) {
        Logger.error(`Failed to update with interaction.update(): ${updateError}`);

        // Fallback to editReply if update fails
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            content: undefined,
            embeds: undefined,
          });
          Logger.debug('Successfully updated page using editReply fallback');
        }
        else {
          throw new Error('Could not update page: interaction not replied or deferred');
        }
      }
    }
    catch (error) {
      Logger.error(`Failed to update pagination page from interaction: ${error}`);
    }
  }

  /**
   * Send a reply to the context
   */
  private async sendReply(
    ctx: Context | ComponentContext | RepliableInteraction,
    container: ContainerBuilder,
  ): Promise<Message | InteractionResponse | null> {
    try {
      // Create options object with components
      const options: InteractionReplyOptions = {
        components: [container],
        flags: this.ephemeral
          ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
          : MessageFlags.IsComponentsV2,
      };

      if (ctx instanceof Context || ctx instanceof ComponentContext) {
        // Check if this is an edit to an existing message
        if (ctx instanceof ComponentContext && ctx.replied) {
          // Create edit options - Ephemeral flag is not allowed in edit operations
          const editOptions: InteractionEditReplyOptions = {
            components: [container],
            flags: MessageFlags.IsComponentsV2,
          };
          await ctx.editReply(editOptions);
          return (await ctx.interaction.fetchReply()) as Message;
        }
        else {
          return await ctx.reply(options);
        }
      }
      else {
        const replyMethod = getReplyMethod(ctx);
        const response = await ctx[replyMethod](options);
        // Convert to appropriate return type
        return response as Message | InteractionResponse<boolean> | null;
      }
    }
    catch (error) {
      Logger.error('Failed to send pagination reply', error);
      return null;
    }
  }
}
