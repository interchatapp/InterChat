import BaseCommand from '#src/core/BaseCommand.js';
import { HelpCommandData, CategoryInfo } from '#src/modules/HelpCommand/DataManager.js';
import Constants from '#src/utils/Constants.js';
import { CustomID } from '#src/utils/CustomID.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { Client, ContainerBuilder, SectionBuilder, ButtonBuilder, ButtonStyle, TextDisplayBuilder } from 'discord.js';

const HELP_COMMAND_BASE = 'help';

/**
 * Class to handle help command UI generation
 */
export class HelpCommandUI {
  private readonly ui: UIComponents;
  private readonly dataManager: HelpCommandData;
  private readonly client: Client;

  /**
   * Create a new HelpCommandUI instance
   * @param client The Discord client
   * @param dataManager The data manager instance
   */
  constructor(client: Client, dataManager: HelpCommandData) {
    this.ui = new UIComponents(client);
    this.dataManager = dataManager;
    this.client = client;
  }

  /**
   * Generate the main help menu container
   * @param categories The categories to display
   * @param showAll Whether to show all categories or just the first 5
   * @returns The container with the main help menu
   */
  public generateMainHelpMenu(categories: CategoryInfo[], showAll = false): ContainerBuilder {
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      this.ui.createHeader('InterChat Help', 'Select a category to explore commands', 'info_icon'),
    );

    // Add separator
    this.ui.addSeparator(container);

    // Determine how many categories to show
    const categoriesToShow = showAll ? categories : categories.slice(0, 5);

    // Add categories as sections
    for (const category of categoriesToShow) {
      const categorySection = new SectionBuilder();

      // Create category description
      const categoryDescription = `### ${getEmoji(category.emoji, this.client)} ${category.name}\n${category.description || 'Commands for InterChat'}`;

      // Create "View Commands" button for this category
      const viewButton = new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier(HELP_COMMAND_BASE, 'category')
            .setArgs(category.id)
            .toString(),
        )
        .setLabel('View Commands')
        .setStyle(ButtonStyle.Secondary);

      // Add to section
      categorySection
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(categoryDescription))
        .setButtonAccessory(viewButton);

      container.addSectionComponents(categorySection);
    }

    // Add pagination info if needed
    if (categories.length > 5 && !showAll) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `*Showing 5 of ${categories.length} categories. Use the \`/help\` command to see all categories.*`,
        ),
      );
    }

    // Add dashboard button
    this.ui.createActionButtons(
      container,
      {
        label: 'Search Commands',
        customId: new CustomID().setIdentifier(HELP_COMMAND_BASE, 'search').toString(),
        emoji: 'search_icon',
      },
      undefined,
      {
        label: 'Open Dashboard',
        url: `${Constants.Links.Website}/dashboard`,
        emoji: 'wand_icon',
      },
    );

    return container;
  }

  /**
   * Generate a category help menu container
   * @param category The category to display
   * @param client The Discord client
   * @returns The container with the category help menu
   */
  public generateCategoryHelp(category: CategoryInfo, client: Client): ContainerBuilder {
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      this.ui.createHeader(
        `${category.name} Commands`,
        category.description || 'Commands for InterChat',
        category.emoji,
      ),
    );

    // Add separator
    this.ui.addSeparator(container);

    // Add command sections (up to 4 to stay under component limits)
    const commandsToShow = category.commands.slice(0, 4);
    const allCommands = client.commands;

    for (const cmdName of commandsToShow) {
      const commandSection = new SectionBuilder();
      const commandParts = cmdName.split(' ');
      const baseCommand = allCommands.get(commandParts[0]);

      if (!baseCommand) continue;

      // Get command mention
      const commandMention = this.dataManager.getCommandMention(cmdName);

      // Create command description
      let commandDescription = `### ${commandMention}\n`;

      // Add description based on command type
      if (commandParts.length === 1) {
        // Base command
        commandDescription += baseCommand.description;
      }
      else if (commandParts.length === 2) {
        // Subcommand
        const subCmd = baseCommand.subcommands?.[commandParts[1]];
        if (subCmd && subCmd instanceof BaseCommand) {
          commandDescription += subCmd.description;
        }
      }
      else if (commandParts.length === 3) {
        // Nested subcommand
        const subCmdGroup = baseCommand.subcommands?.[commandParts[1]];
        if (subCmdGroup && !(subCmdGroup instanceof BaseCommand)) {
          const nestedCmd = subCmdGroup[commandParts[2]];
          if (nestedCmd) {
            commandDescription += nestedCmd.description;
          }
        }
      }

      // Create "View Details" button
      const detailsButton = new ButtonBuilder()
        .setCustomId(
          new CustomID().setIdentifier(HELP_COMMAND_BASE, 'command').setArgs(cmdName).toString(),
        )
        .setLabel('View Details')
        .setStyle(ButtonStyle.Secondary);

      // Add to section
      commandSection
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(commandDescription))
        .setButtonAccessory(detailsButton);

      container.addSectionComponents(commandSection);
    }

    // Add "More Commands" message if needed
    if (category.commands.length > 4) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `*Showing 4 of ${category.commands.length} commands. Use \`/help command:<command>\` to see specific commands.*`,
        ),
      );
    }

    // Add back button
    this.ui.createActionButtons(container, {
      label: 'Back to Categories',
      customId: new CustomID().setIdentifier(HELP_COMMAND_BASE, 'main').toString(),
      emoji: 'person_icon',
    });

    return container;
  }

  /**
   * Generate a command help container
   * @param commandName The command name
   * @param client The Discord client
   * @returns The container with the command help
   */
  public generateCommandHelp(commandName: string, client: Client): ContainerBuilder | null {
    const container = new ContainerBuilder();

    // Parse the command name
    const commandPath = commandName.split(' ');
    const baseCommand = client.commands.get(commandPath[0]);

    if (!baseCommand) {
      return null;
    }

    // Get command mention
    const commandMention = this.dataManager.getCommandMention(commandName);

    // Add header
    container.addTextDisplayComponents(
      this.ui.createHeader(`Command: ${commandPath[0]}`, baseCommand.description, 'info_icon'),
    );

    // Add separator
    this.ui.addSeparator(container);

    // Build command details
    let commandDetails = '';

    // Add usage information
    commandDetails += '## Usage\n';
    commandDetails += `${commandMention}`;

    // Add options if any
    if (baseCommand.options && baseCommand.options.length > 0) {
      commandDetails += '\n\n## Options\n';
      for (const option of baseCommand.options) {
        const required = option.required ? '(required)' : '(optional)';
        commandDetails += `- \`${option.name}\`: ${option.description} ${required}\n`;
      }
    }

    // Add subcommands if any
    if (baseCommand.subcommands && Object.keys(baseCommand.subcommands).length > 0) {
      commandDetails += '\n## Subcommands\n';

      for (const [name, subCmd] of Object.entries(baseCommand.subcommands)) {
        if (subCmd instanceof BaseCommand) {
          // Direct subcommand
          const subCmdName = `${baseCommand.name} ${name}`;
          const subCmdMention = this.dataManager.getCommandMention(subCmdName);
          commandDetails += `- ${subCmdMention}: ${subCmd.description}\n`;
        }
        else {
          // Nested subcommands
          for (const [subName, nestedCmd] of Object.entries(subCmd)) {
            // Get nested subcommand mention
            const nestedCmdName = `${baseCommand.name} ${name} ${subName}`;
            const nestedCmdMention = this.dataManager.getCommandMention(nestedCmdName);
            commandDetails += `- ${nestedCmdMention}: ${nestedCmd.description}\n`;
          }
        }
      }
    }

    // Add examples
    commandDetails += '\n## Examples\n';
    commandDetails += `- ${commandMention} - Basic usage\n`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(commandDetails));

    // Find which category this command belongs to
    const commandCategory = this.dataManager.findCategoryForCommand(commandPath[0]);

    // Add back button and related commands
    this.ui.createActionButtons(
      container,
      {
        label: 'Back to Categories',
        customId: new CustomID().setIdentifier(HELP_COMMAND_BASE, 'main').toString(),
        emoji: 'person_icon',
      },
      commandCategory
        ? {
          label: `Back to ${commandCategory.name}`,
          customId: new CustomID()
            .setIdentifier(HELP_COMMAND_BASE, 'category')
            .setArgs(commandCategory.id)
            .toString(),
          emoji: commandCategory.emoji,
        }
        : undefined,
    );

    return container;
  }

  /**
   * Generate a search help container
   * @returns The container with the search help
   */
  public generateSearchHelp(): ContainerBuilder {
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      this.ui.createHeader(
        'Search Commands',
        'Find commands by name or description',
        'search_icon',
      ),
    );

    // Add search instructions
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        'Use the search button below to find commands by name or description. You can also browse commands by category.',
      ),
    );

    // Add back button
    this.ui.createActionButtons(container, {
      label: 'Back to Categories',
      customId: new CustomID().setIdentifier(HELP_COMMAND_BASE, 'main').toString(),
      emoji: 'person_icon',
    });

    return container;
  }

  /**
   * Generate an error container
   * @param title The error title
   * @param message The error message
   * @returns The container with the error message
   */
  public generateErrorContainer(title: string, message: string): ContainerBuilder {
    return this.ui.createErrorMessage(title, message);
  }
}
