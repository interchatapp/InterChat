import BaseCommand from '#src/core/BaseCommand.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import Context from '#src/core/CommandContext/Context.js';
import { EmojiKeys } from '#src/utils/EmojiUtils.js';
import { AutocompleteInteraction, chatInputApplicationCommandMention, ApplicationCommandOptionType } from 'discord.js';
import Logger from '#src/utils/Logger.js';

/**
 * Interface for command mention cache
 */
interface CommandMentionCache {
  [commandName: string]: {
    id: string;
    mention: string;
  };
}

/**
 * Interface for category information
 */
export interface CategoryInfo {
  id: string;
  name: string;
  emoji: EmojiKeys;
  commands: string[];
  description?: string;
}

/**
 * Class to handle help command data operations
 */
export class HelpCommandData {
  // Emoji mapping for categories based on folder names
  private readonly categoryEmojis: Record<string, EmojiKeys> = {
    Information: 'info_icon',
    Main: 'chat_icon',
    Hub: 'house_icon',
    Moderation: 'hammer_icon',
    Settings: 'gear_icon',
    Staff: 'hammer_icon',
    Fun: 'fire_icon',
    Utility: 'gear_icon',
  };

  // Cache for discovered categories
  private categories: CategoryInfo[] = [];

  // Cache for command mentions
  private commandMentions: CommandMentionCache = {};

  /**
   * Format a category folder name into a readable name
   * @param folderName The folder name to format
   * @returns The formatted category name
   */
  private formatCategoryName(folderName: string): string {
    // Special case handling
    switch (folderName) {
      case 'Hub':
        return 'Hub Management';
      default:
        return folderName;
    }
  }

  /**
   * Get a description for a category
   * @param categoryId The category ID
   * @returns The category description
   */
  private getCategoryDescription(categoryId: string): string {
    // Special case handling
    switch (categoryId) {
      case 'information':
        return 'Get help and information about InterChat';
      case 'main':
        return 'Core commands for connecting with other users';
      case 'hub':
        return 'Manage your hubs and connections';
      case 'moderation':
        return 'Moderation tools for server admins';
      case 'settings':
        return 'Configure InterChat settings';
      case 'staff':
        return 'Commands for InterChat staff members';
      case 'fun':
        return 'Fun commands to use with friends';
      case 'utility':
        return 'Utility commands for various purposes';
      default:
        return 'Commands for InterChat';
    }
  }

  /**
   * Discover categories and commands using command metadata
   * @param ctx Context or AutocompleteInteraction to get client from
   * @returns Array of discovered categories
   */
  public async discoverCategories(
    ctx: Context | AutocompleteInteraction | ComponentContext,
  ): Promise<CategoryInfo[]> {
    // Return cached categories if already discovered
    if (this.categories.length > 0) {
      return this.categories;
    }

    // Get all commands from the client's commands collection
    const allCommands = Array.from(ctx.client.commands.values()) as BaseCommand[];

    // Group commands by category
    const categoriesMap = new Map<string, BaseCommand[]>();

    // First, group commands by their category
    for (const command of allCommands) {
      if (!command.category) continue; // Skip commands without category metadata

      if (!categoriesMap.has(command.category)) {
        categoriesMap.set(command.category, []);
      }

      categoriesMap.get(command.category)?.push(command);
    }

    // Convert the map to our CategoryInfo format
    const categories: CategoryInfo[] = [];

    for (const [categoryName, commands] of categoriesMap.entries()) {
      const categoryId = categoryName.toLowerCase();
      const emoji = this.categoryEmojis[categoryName] || 'info_icon';

      // Get command names, including subcommands
      const commandNames: string[] = [];

      for (const command of commands) {
        // Add the base command
        commandNames.push(command.name);

        // Add subcommands if any
        if (command.subcommands) {
          for (const [subName, subCmd] of Object.entries(command.subcommands)) {
            if (subCmd instanceof BaseCommand) {
              commandNames.push(`${command.name} ${subName}`);
            }
            else {
              // Nested subcommands
              for (const [nestedName] of Object.entries(subCmd)) {
                commandNames.push(`${command.name} ${subName} ${nestedName}`);
              }
            }
          }
        }
      }

      categories.push({
        id: categoryId,
        name: this.formatCategoryName(categoryName),
        emoji: emoji as EmojiKeys,
        commands: commandNames,
        description: this.getCategoryDescription(categoryId),
      });
    }

    // Sort categories alphabetically
    categories.sort((a, b) => a.name.localeCompare(b.name));

    // Cache the discovered categories
    this.categories = categories;
    return categories;
  }

  /**
   * Fetch and cache command mentions
   * @param ctx Context or AutocompleteInteraction to get client from
   */
  public async fetchCommandMentions(
    ctx: Context | AutocompleteInteraction | ComponentContext,
  ): Promise<void> {
    // Skip if we already have command mentions cached
    if (Object.keys(this.commandMentions).length > 0) return;

    try {
      // Fetch application commands
      const commands = await ctx.client.application?.commands.fetch();
      if (!commands) return;

      // Cache command mentions
      for (const [id, command] of commands) {
        this.commandMentions[command.name] = {
          id,
          mention: chatInputApplicationCommandMention(command.name, id),
        };

        // Handle subcommands
        if (command.options) {
          for (const option of command.options) {
            if (
              option.type === ApplicationCommandOptionType.Subcommand ||
              option.type === ApplicationCommandOptionType.SubcommandGroup
            ) {
              if (option.type === ApplicationCommandOptionType.Subcommand) {
                const subcommandName = `${command.name} ${option.name}`;
                this.commandMentions[subcommandName] = {
                  id,
                  mention: chatInputApplicationCommandMention(command.name, id, option.name),
                };
              }
              else if (option.options) {
                // Handle nested subcommands
                for (const subOption of option.options) {
                  if (subOption.type === ApplicationCommandOptionType.Subcommand) {
                    const nestedSubcommandName = `${command.name} ${option.name} ${subOption.name}`;
                    this.commandMentions[nestedSubcommandName] = {
                      id,
                      mention: chatInputApplicationCommandMention(
                        command.name,
                        id,
                        option.name,
                        subOption.name,
                      ),
                    };
                  }
                }
              }
            }
          }
        }
      }
    }
    catch (error) {
      Logger.error('Error fetching command mentions', error);
    }
  }

  /**
   * Get a command mention by name
   * @param commandName The command name
   * @returns The command mention or a fallback
   */
  public getCommandMention(commandName: string): string {
    return this.commandMentions[commandName]?.mention || `\`/${commandName}\``;
  }

  /**
   * Get all categories
   * @returns Array of categories
   */
  public getCategories(): CategoryInfo[] {
    return this.categories;
  }

  /**
   * Find a category by ID
   * @param categoryId The category ID to find
   * @returns The category or undefined if not found
   */
  public findCategory(categoryId: string): CategoryInfo | undefined {
    return this.categories.find((c) => c.id === categoryId);
  }

  /**
   * Find the category for a command
   * @param commandName The command name
   * @returns The category or undefined if not found
   */
  public findCategoryForCommand(commandName: string): CategoryInfo | undefined {
    // Get the base command name (first part before any spaces)
    const baseCommandName = commandName.split(' ')[0];

    return this.categories.find((category) =>
      category.commands.some((cmd) => cmd.startsWith(baseCommandName)),
    );
  }
}

