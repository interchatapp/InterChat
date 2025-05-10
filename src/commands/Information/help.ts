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

import BaseCommand from '#src/core/BaseCommand.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import type Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { HelpCommandData, CategoryInfo } from '#src/modules/HelpCommand/DataManager.js';
import { HelpCommandUI } from '#src/modules/HelpCommand/HelpCommandUI.js';
import Logger from '#src/utils/Logger.js';
import { PaginationManager } from '#src/utils/ui/PaginationManager.js';
import { ApplicationCommandOptionType, AutocompleteInteraction, MessageFlags } from 'discord.js';

// Command identifier used for all custom IDs
const HELP_COMMAND_BASE = 'help';

/**
 * Redesigned help command using the InterChat v5 design system
 * Dynamically scans command folders to build categories and command lists
 */
export default class HelpCommand extends BaseCommand {
  private readonly dataManager: HelpCommandData;
  private uiManager: HelpCommandUI;

  constructor() {
    super({
      name: 'help',
      description: '📚 Explore InterChat commands with our new help system',
      types: { slash: true, prefix: true },
      options: [
        {
          name: 'command',
          description: 'The command to get info about',
          type: ApplicationCommandOptionType.String,
          required: false,
          autocomplete: true,
        },
        {
          name: 'category',
          description: 'View commands by category',
          type: ApplicationCommandOptionType.String,
          required: false,
          autocomplete: true,
        },
      ],
    });

    // Initialize data manager
    this.dataManager = new HelpCommandData();
    // UI manager will be initialized in execute with the client
    this.uiManager = null as unknown as HelpCommandUI;
  }

  /**
   * Execute the help command
   * @param ctx The command context
   */
  async execute(ctx: Context): Promise<void> {
    // Initialize UI manager with the current client
    this.uiManager = new HelpCommandUI(ctx.client, this.dataManager);

    const commandName = ctx.options.getString('command');
    const categoryId = ctx.options.getString('category');

    // Discover categories and commands
    await this.dataManager.discoverCategories(ctx);

    // Fetch and cache command mentions
    await this.dataManager.fetchCommandMentions(ctx);

    try {
      // If a specific command was requested
      if (commandName) {
        return await this.showCommandHelp(ctx, commandName);
      }

      // If a category was requested
      if (categoryId) {
        return await this.showCategoryHelp(ctx, categoryId);
      }

      // Show the main help menu with categories using pagination
      await this.showMainHelpMenu(ctx);
    }
    catch (error) {
      Logger.error('Error executing help command', error);
      await ctx.reply({
        content: `${ctx.getEmoji('x_icon')} An error occurred while showing the help menu.`,
        flags: [MessageFlags.Ephemeral],
      });
    }
  }

  /**
   * Show the main help menu with categories using pagination
   * @param ctx The command context
   */
  private async showMainHelpMenu(ctx: Context | ComponentContext): Promise<void> {
    try {
      // Create pagination manager for categories
      const pagination = new PaginationManager<CategoryInfo>({
        client: ctx.client,
        identifier: `${HELP_COMMAND_BASE}_main`,
        items: this.dataManager.getCategories(),
        itemsPerPage: 5, // 5 categories per page (to stay well under the 40 component limit)
        contentGenerator: (_pageIndex, categoriesOnPage) =>
          this.uiManager.generateMainHelpMenu(categoriesOnPage, true),
        idleTimeout: 300000, // 5 minutes
        ephemeral: false,
        deleteOnEnd: false,
      });

      // Start pagination
      await pagination.start(ctx);
    }
    catch (error) {
      Logger.error('Error showing main help menu', error);
      await ctx.reply({
        content: `${ctx.getEmoji('x_icon')} An error occurred while showing the help menu.`,
        flags: [MessageFlags.Ephemeral],
      });
    }
  }

  /**
   * Show commands for a specific category
   * @param ctx The command context
   * @param categoryId The category ID
   */
  private async showCategoryHelp(
    ctx: Context | ComponentContext,
    categoryId: string,
  ): Promise<void> {
    try {
      const category = this.dataManager.findCategory(categoryId);

      if (!category) {
        const errorMessage = `${ctx.getEmoji('x_icon')} Category not found.`;

        if (ctx instanceof ComponentContext) {
          await ctx.editReply({
            content: errorMessage,
          });
        }
        else {
          await ctx.reply({
            content: errorMessage,
            flags: [MessageFlags.Ephemeral],
          });
        }
        return;
      }

      // Generate category help container
      const container = this.uiManager.generateCategoryHelp(category, ctx.client);

      // Use editReply if it's a ComponentContext, otherwise use reply
      if (ctx instanceof ComponentContext) {
        await ctx.editReply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        });
      }
      else {
        await ctx.reply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        });
      }
    }
    catch (error) {
      Logger.error('Error showing category help', error);
      const errorMessage = `${ctx.getEmoji('x_icon')} An error occurred while showing the category.`;

      if (ctx instanceof ComponentContext) {
        await ctx.editReply({
          content: errorMessage,
        });
      }
      else {
        await ctx.reply({
          content: errorMessage,
          flags: [MessageFlags.Ephemeral],
        });
      }
    }
  }

  /**
   * Show help for a specific command
   * @param ctx The command context
   * @param commandName The command name
   */
  private async showCommandHelp(
    ctx: Context | ComponentContext,
    commandName: string,
  ): Promise<void> {
    try {
      // Generate command help container
      const container = this.uiManager.generateCommandHelp(commandName, ctx.client);

      if (!container) {
        const errorMessage = `${ctx.getEmoji('x_icon')} Command \`${commandName.split(' ')[0]}\` not found.`;

        await ctx.reply({
          content: errorMessage,
          flags: [MessageFlags.Ephemeral],
        });

        return;
      }

      await ctx.reply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
    catch (error) {
      Logger.error('Error showing command help', error);
      const errorMessage = `${ctx.getEmoji('x_icon')} An error occurred while showing the command help.`;

      if (ctx instanceof ComponentContext) {
        await ctx.editReply({
          content: errorMessage,
        });
      }
      else {
        await ctx.reply({
          content: errorMessage,
          flags: [MessageFlags.Ephemeral],
        });
      }
    }
  }

  /**
   * Handle autocomplete requests for the help command
   * @param interaction The autocomplete interaction
   */
  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    try {
      // Get the focused option
      const focusedOption = interaction.options.getFocused(true);
      const focusedValue = focusedOption.value.toString().toLowerCase();

      // Ensure categories are discovered
      await this.dataManager.discoverCategories(interaction);

      // Fetch and cache command mentions
      await this.dataManager.fetchCommandMentions(interaction);

      // Handle different option types
      if (focusedOption.name === 'command') {
        await this.handleCommandAutocomplete(interaction, focusedValue);
      }
      else if (focusedOption.name === 'category') {
        await this.handleCategoryAutocomplete(interaction, focusedValue);
      }
    }
    catch (error) {
      // Log the error but don't crash
      Logger.error('Error in help command autocomplete', error);

      // Respond with an empty array to prevent the autocomplete from breaking
      await interaction.respond([]);
    }
  }

  /**
   * Handle autocomplete for the command option
   * @param interaction The autocomplete interaction
   * @param focusedValue The current input value
   */
  private async handleCommandAutocomplete(
    interaction: AutocompleteInteraction,
    focusedValue: string,
  ): Promise<void> {
    // Get all commands from all categories
    const allCommands = this.dataManager.getCategories().flatMap((category) => category.commands);

    // Filter commands based on the input
    let filteredCommands = allCommands.filter((command) =>
      command.toLowerCase().includes(focusedValue),
    );

    // If no commands match, return a helpful message
    if (filteredCommands.length === 0 && focusedValue.length > 0) {
      await interaction.respond([
        {
          name: `No commands found matching "${focusedValue}"`,
          value: focusedValue,
        },
      ]);
      return;
    }

    // Sort commands alphabetically
    filteredCommands.sort((a, b) => a.localeCompare(b));

    // Limit to 25 results
    filteredCommands = filteredCommands.slice(0, 25);

    // Format the results
    const results = filteredCommands.map((command) => {
      // Get the base command name (first part before any spaces)
      const baseCommandName = command.split(' ')[0];

      // Find the category for this command
      const category = this.dataManager.findCategoryForCommand(baseCommandName);

      // Format the display name with category if available
      const displayName = category ? `${command} (${category.name})` : command;

      return {
        name: displayName,
        value: command,
      };
    });

    // Respond with the results
    await interaction.respond(results);
  }

  /**
   * Handle autocomplete for the category option
   * @param interaction The autocomplete interaction
   * @param focusedValue The current input value
   */
  private async handleCategoryAutocomplete(
    interaction: AutocompleteInteraction,
    focusedValue: string,
  ): Promise<void> {
    // Filter categories based on the input
    let filteredCategories = this.dataManager
      .getCategories()
      .filter(
        (category) =>
          category.name.toLowerCase().includes(focusedValue) ||
          category.id.toLowerCase().includes(focusedValue) ||
          (category.description && category.description.toLowerCase().includes(focusedValue)),
      );

    // If no categories match, return a helpful message
    if (filteredCategories.length === 0 && focusedValue.length > 0) {
      await interaction.respond([
        {
          name: `No categories found matching "${focusedValue}"`,
          value: focusedValue,
        },
      ]);
      return;
    }

    // Sort categories alphabetically
    filteredCategories.sort((a, b) => a.name.localeCompare(b.name));

    // Limit to 25 results
    filteredCategories = filteredCategories.slice(0, 25);

    // Format the results
    const results = filteredCategories.map((category) => {
      // Get the most popular commands in this category (up to 3)
      const popularCommands = category.commands
        .filter((cmd) => !cmd.includes(' ')) // Only base commands, not subcommands
        .slice(0, 3)
        .map((cmd) => cmd.split(' ')[0]) // Get just the base command name
        .join(', ');

      // Format with command count and popular commands
      const displayName = `${category.name} (${category.commands.length} commands${popularCommands ? `: ${popularCommands}...` : ''})`;

      return {
        name: displayName,
        value: category.id,
      };
    });

    // Respond with the results
    await interaction.respond(results);
  }

  /**
   * Handler for the main help button
   */
  @RegisterInteractionHandler(HELP_COMMAND_BASE, 'main')
  async handleMainButton(ctx: ComponentContext): Promise<void> {
    try {
      await ctx.deferUpdate();

      // Discover categories and commands
      await this.dataManager.discoverCategories(ctx);

      // Fetch and cache command mentions
      await this.dataManager.fetchCommandMentions(ctx);

      // Generate main help menu
      const container = this.uiManager.generateMainHelpMenu(this.dataManager.getCategories());

      // Update the message
      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
    catch (error) {
      Logger.error('Error handling main button', error);
      const errorContainer = this.uiManager.generateErrorContainer(
        'Error',
        `${ctx.getEmoji('x_icon')} An error occurred while showing the help menu.`,
      );
      await ctx.editReply({
        components: [errorContainer],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  /**
   * Handler for category buttons
   */
  @RegisterInteractionHandler(HELP_COMMAND_BASE, 'category')
  async handleCategoryButton(ctx: ComponentContext): Promise<void> {
    try {
      await ctx.deferUpdate();

      // Discover categories and commands
      await this.dataManager.discoverCategories(ctx);

      // Fetch and cache command mentions
      await this.dataManager.fetchCommandMentions(ctx);

      const categoryId = ctx.customId.args[0];
      await this.showCategoryHelp(ctx, categoryId);
    }
    catch (error) {
      Logger.error('Error handling category button', error);
      const errorContainer = this.uiManager.generateErrorContainer(
        'Error',
        `${ctx.getEmoji('x_icon')} An error occurred while showing the category.`,
      );
      await ctx.editReply({
        components: [errorContainer],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  /**
   * Handler for command buttons
   */
  @RegisterInteractionHandler(HELP_COMMAND_BASE, 'command')
  async handleCommandButton(ctx: ComponentContext): Promise<void> {
    try {
      await ctx.deferUpdate();

      // Discover categories and commands
      await this.dataManager.discoverCategories(ctx);

      // Fetch and cache command mentions
      await this.dataManager.fetchCommandMentions(ctx);

      const commandName = ctx.customId.args[0];
      await this.showCommandHelp(ctx, commandName);
    }
    catch (error) {
      Logger.error('Error handling command button', error);
      const errorContainer = this.uiManager.generateErrorContainer(
        'Error',
        `${ctx.getEmoji('x_icon')} An error occurred while showing the command help.`,
      );
      await ctx.editReply({
        components: [errorContainer],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  /**
   * Handler for search buttons
   */
  @RegisterInteractionHandler(HELP_COMMAND_BASE, 'search')
  async handleSearchButton(ctx: ComponentContext): Promise<void> {
    try {
      await ctx.deferUpdate();

      // Discover categories and commands
      await this.dataManager.discoverCategories(ctx);

      // Fetch and cache command mentions
      await this.dataManager.fetchCommandMentions(ctx);

      // Generate search help container
      const container = this.uiManager.generateSearchHelp();

      // Update the message
      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
    catch (error) {
      Logger.error('Error handling search button', error);
      const errorContainer = this.uiManager.generateErrorContainer(
        'Error',
        `${ctx.getEmoji('x_icon')} An error occurred while showing the search interface.`,
      );
      await ctx.editReply({
        components: [errorContainer],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }
}
