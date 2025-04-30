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
import type Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { fetchCommands } from '#src/utils/CommandUtils.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Constants from '#utils/Constants.js';
import {
  ApplicationCommandOptionType,
  chatInputApplicationCommandMention,
  Collection,
  AutocompleteInteraction,
  ApplicationCommand,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  MessageFlags,
  SeparatorSpacingSize,
} from 'discord.js';

interface CommandInfo {
  name: string;
  description: string;
  subcommands?: Map<string, CommandInfo | Map<string, CommandInfo>>;
}

export default class HelpCommand extends BaseCommand {
  constructor() {
    super({
      name: 'help',
      description: '📚 List all commands or get detailed info about a specific command.',
      types: { slash: true, prefix: true },
      options: [
        {
          name: 'command',
          description: 'The command to get info about.',
          type: ApplicationCommandOptionType.String,
          required: false,
          autocomplete: true,
        },
      ],
    });
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const commands = Array.from(interaction.client.commands.values());
    const choices: { name: string; value: string }[] = [];

    const formatChoice = (name: string, description: string) => {
      // Truncate description to fit within Discord's 100-character limit
      const maxLength = 100;
      const separator = ' - ';
      let displayName = `${name}${separator}${description}`;

      if (displayName.length > maxLength) {
        const nameLength = name.length;
        const sepLength = separator.length;
        const availableSpace = maxLength - nameLength - sepLength - 3; // 3 for "..."
        displayName = `${name}${separator}${description.slice(0, availableSpace)}...`;
      }

      return {
        name: displayName,
        value: name,
      };
    };

    for (const cmd of commands) {
      // Add main command
      if (
        cmd.name.toLowerCase().includes(focusedValue) ||
        cmd.description.toLowerCase().includes(focusedValue)
      ) {
        choices.push(formatChoice(cmd.name, cmd.description));
      }

      // Add subcommands
      if (cmd.subcommands) {
        for (const [subName, subCmd] of Object.entries(cmd.subcommands)) {
          if (subCmd instanceof BaseCommand) {
            const fullName = `${cmd.name} ${subName}`;
            if (
              fullName.toLowerCase().includes(focusedValue) ||
              subCmd.description.toLowerCase().includes(focusedValue)
            ) {
              choices.push(formatChoice(fullName, subCmd.description));
            }
          }
          else {
            // Handle nested subcommands
            for (const [nestedName, nestedCmd] of Object.entries(subCmd)) {
              if (nestedCmd instanceof BaseCommand) {
                const fullName = `${cmd.name} ${subName} ${nestedName}`;
                if (
                  fullName.toLowerCase().includes(focusedValue) ||
                  nestedCmd.description.toLowerCase().includes(focusedValue)
                ) {
                  choices.push(formatChoice(fullName, nestedCmd.description));
                }
              }
            }
          }
        }
      }
    }

    await interaction.respond(choices.slice(0, 25));
  }

  private async formatCommandPath(
    command: CommandInfo,
    emoji: string,
    parentPath = '',
    applicationCommands?: Collection<string, ApplicationCommand>,
  ): Promise<string> {
    const currentPath = parentPath ? `${parentPath} ${command.name}` : command.name;
    const baseCommandName = currentPath.split(' ')[0];
    const appCommand = applicationCommands?.find((cmd) => cmd.name === baseCommandName);

    let output = '';

    // If this is a subcommand, show the full path with mention
    if (parentPath) {
      if (appCommand) {
        const pathParts = currentPath.split(' ');
        if (pathParts.length === 2) {
          // Single level subcommand
          const mention = chatInputApplicationCommandMention(
            baseCommandName,
            command.name,
            appCommand.id,
          );
          output = `### ${mention}\n${command.description}\n`;
        }
        else if (pathParts.length === 3) {
          // Nested subcommand
          const mention = chatInputApplicationCommandMention(
            baseCommandName,
            pathParts[1],
            command.name,
            appCommand.id,
          );
          output = `### ${mention}\n${command.description}\n`;
        }
      }
      else {
        output = `### \`/${currentPath}\`\n${command.description}\n`;
      }
    }
    else {
      // For base commands, use mention if possible
      const cmdMention = appCommand
        ? chatInputApplicationCommandMention(command.name, appCommand.id)
        : `/${command.name}`;
      output = `### ${cmdMention}\n${command.description}\n`;
    }

    if (command.subcommands?.size) {
      output += '\n**Subcommands:**\n';
      for (const [name, subCmd] of command.subcommands) {
        if (subCmd instanceof Map) {
          // Handle nested subcommands (e.g., hub config logging)
          for (const [subName, subSubCmd] of subCmd) {
            if (appCommand) {
              const mention = chatInputApplicationCommandMention(
                baseCommandName,
                name,
                subName,
                appCommand.id,
              );
              output += `${emoji} ${mention} - ${subSubCmd.description}\n`;
            }
            else {
              output += `${emoji} \`/${currentPath} ${name} ${subName}\` - ${subSubCmd.description}\n`;
            }
          }
        }
        // Handle single-level subcommands
        else if (appCommand) {
          const mention = chatInputApplicationCommandMention(baseCommandName, name, appCommand.id);
          output += `${emoji} ${mention} - ${subCmd.description}\n`;
        }
        else {
          output += `${emoji} \`/${currentPath} ${name}\` - ${subCmd.description}\n`;
        }
      }
    }

    return output;
  }

  private getCommandInfo(command: BaseCommand): CommandInfo {
    const info: CommandInfo = {
      name: command.name,
      description: command.description,
    };

    if (command.subcommands) {
      info.subcommands = new Map();
      for (const [name, subCmd] of Object.entries(command.subcommands)) {
        if (subCmd instanceof BaseCommand) {
          info.subcommands.set(name, this.getCommandInfo(subCmd));
        }
        else {
          const nestedSubcommands = new Map();
          for (const [subName, subSubCmd] of Object.entries(subCmd)) {
            if (subSubCmd instanceof BaseCommand) {
              nestedSubcommands.set(subName, this.getCommandInfo(subSubCmd));
            }
          }
          info.subcommands.set(name, nestedSubcommands);
        }
      }
    }

    return info;
  }

  private getSubcommandFromPath(command: BaseCommand, path: string[]): BaseCommand | null {
    if (path.length === 0) return command;
    if (!command.subcommands) return null;

    const [next, ...rest] = path;
    const subCmd = command.subcommands[next];

    if (!subCmd) return null;
    if (subCmd instanceof BaseCommand) return rest.length === 0 ? subCmd : null;

    const nestedCmd = subCmd[rest[0]];
    return nestedCmd instanceof BaseCommand ? nestedCmd : null;
  }

  async execute(ctx: Context) {
    const applicationCommands = await fetchCommands(ctx.client);
    const commandPath = ctx.options.getString('command')?.split(' ') ?? [];

    if (commandPath.length > 0) {
      // Handle specific command help with Components v2
      const baseCommand = ctx.client.commands.get(commandPath[0]);
      if (!baseCommand) {
        await ctx.reply({
          content: `${ctx.getEmoji('x_icon')} Command \`${commandPath[0]}\` not found.`,
          flags: ['Ephemeral'],
        });
        return;
      }

      const command = this.getSubcommandFromPath(baseCommand, commandPath.slice(1));
      if (!command) {
        await ctx.reply({
          content: `${ctx.getEmoji('x_icon')} Subcommand \`${commandPath.join(' ')}\` not found.`,
          flags: ['Ephemeral'],
        });
        return;
      }

      // Create Components v2 container for command details
      const container = new ContainerBuilder();

      // Add header
      const headerText = new TextDisplayBuilder().setContent(
        `# ${ctx.getEmoji('wand_icon')} Command Help: /${commandPath.join(' ')}`,
      );
      container.addTextDisplayComponents(headerText);

      // Add command description and usage
      const commandInfo = this.getCommandInfo(command);
      const commandDetailsText = new TextDisplayBuilder().setContent(
        await this.formatCommandPath(
          commandInfo,
          ctx.getEmoji('dot'),
          commandPath.slice(0, -1).join(' '),
          applicationCommands,
        ),
      );
      container.addTextDisplayComponents(commandDetailsText);

      // Add options if available
      if (command.options?.length) {
        const optionsText = new TextDisplayBuilder().setContent(
          `## Options\n${command.options.map((opt) => `\`${opt.name}\` - ${opt.description}`).join('\n')}`,
        );
        container.addTextDisplayComponents(optionsText);
      }

      // Add dashboard button
      const dashboardButton = new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Open Dashboard')
        .setURL(`${Constants.Links.Website}/dashboard`)
        .setEmoji(ctx.getEmoji('wand_icon'));

      const dashboardSection = new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('Need a visual interface? Check out our dashboard:'),
        )
        .setButtonAccessory(dashboardButton);

      container.addSectionComponents(dashboardSection);

      // Send the response
      await ctx.reply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    // Handle general help menu with Components v2
    const commands = Array.from(ctx.client.commands.values());
    const commandsPerPage = 5;
    const totalPages = Math.ceil(commands.length / commandsPerPage);

    // Get current page commands
    const currentPage = 0; // Start with first page
    const pageCommands = commands.slice(
      currentPage * commandsPerPage,
      (currentPage + 1) * commandsPerPage,
    );

    // Create container for help menu
    const container = new ContainerBuilder();

    // Add header
    const headerText = new TextDisplayBuilder().setContent(
      `# ${ctx.getEmoji('wand_icon')} InterChat Commands\nWelcome to InterChat's help menu! Below you'll find all available commands.`,
    );
    container.addTextDisplayComponents(headerText);

    // Add separator
    container.addSeparatorComponents();

    // Add command sections with buttons
    for (const cmd of pageCommands) {
      // Create a brief description of the command
      const commandDescription = `### /${cmd.name}\n${cmd.description}`;

      // Create a "View Details" button for this command
      const detailsButton = new ButtonBuilder()
        .setCustomId(new CustomID().setIdentifier('help', 'details').setArgs(cmd.name).toString())
        .setLabel('View Details')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(ctx.getEmoji('info'));

      // Create a section for this command
      const commandSection = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(commandDescription))
        .setButtonAccessory(detailsButton);

      container.addSectionComponents(commandSection);
    }

    // Add page indicator
    const pageIndicatorText = new TextDisplayBuilder().setContent(
      `Page ${currentPage + 1}/${totalPages} • Click on a button to view command details`,
    );
    container.addTextDisplayComponents(pageIndicatorText);

    // Add navigation buttons
    const prevButton = new ButtonBuilder()
      .setCustomId(new CustomID().setIdentifier('help', 'prev').setArgs('0').toString())
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(ctx.getEmoji('arrow_left'))
      .setDisabled(currentPage === 0);

    const nextButton = new ButtonBuilder()
      .setCustomId(new CustomID().setIdentifier('help', 'next').setArgs('0').toString())
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(ctx.getEmoji('arrow_right'))
      .setDisabled(currentPage === totalPages - 1);

    const dashboardButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Open Dashboard')
      .setURL(`${Constants.Links.Website}/dashboard`)
      .setEmoji(ctx.getEmoji('wand_icon'));

    container.addActionRowComponents((row) =>
      row.addComponents(prevButton, nextButton, dashboardButton),
    );

    // Send the response
    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Creates a help container for the specified page
   */
  private async createHelpContainer(
    interaction: ButtonInteraction,
    currentPage: number,
    totalPages: number,
    commands: BaseCommand[],
  ) {
    const commandsPerPage = 5;
    const pageCommands = commands.slice(
      currentPage * commandsPerPage,
      (currentPage + 1) * commandsPerPage,
    );

    // Create container for help menu
    const container = new ContainerBuilder();

    // Add header
    const headerText = new TextDisplayBuilder().setContent(
      `## ${getEmoji('wand_icon', interaction.client)} InterChat Commands\nWelcome to InterChat's help menu! Below you'll find all available commands.`,
    );
    container.addTextDisplayComponents(headerText);

    // Add separator
    container.addSeparatorComponents((separator) =>
      separator.setDivider(true).setSpacing(SeparatorSpacingSize.Large),
    );

    // Add command sections with buttons
    for (const cmd of pageCommands) {
      // Create a brief description of the command
      const commandDescription = `### /${cmd.name}\n${cmd.description}`;

      // Create a "View Details" button for this command
      const detailsButton = new ButtonBuilder()
        .setCustomId(new CustomID().setIdentifier('help', 'details').setArgs(cmd.name).toString())
        .setLabel('View Details')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(getEmoji('info', interaction.client));

      // Create a section for this command
      const commandSection = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(commandDescription))
        .setButtonAccessory(detailsButton);

      container.addSectionComponents(commandSection);
    }

    // Add page indicator
    const pageIndicatorText = new TextDisplayBuilder().setContent(
      `Page ${currentPage + 1}/${totalPages} • Click on a button to view command details`,
    );
    container.addTextDisplayComponents(pageIndicatorText);

    // Add navigation buttons
    const prevButton = new ButtonBuilder()
      .setCustomId(
        new CustomID().setIdentifier('help', 'prev').setArgs(currentPage.toString()).toString(),
      )
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('arrow_left', interaction.client))
      .setDisabled(currentPage === 0);

    const nextButton = new ButtonBuilder()
      .setCustomId(
        new CustomID().setIdentifier('help', 'next').setArgs(currentPage.toString()).toString(),
      )
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(getEmoji('arrow_right', interaction.client))
      .setDisabled(currentPage === totalPages - 1);

    const dashboardButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Open Dashboard')
      .setURL(`${Constants.Links.Website}/dashboard`)
      .setEmoji(getEmoji('wand_icon', interaction.client));

    container.addActionRowComponents((row) =>
      row.addComponents(prevButton, nextButton, dashboardButton),
    );

    return container;
  }

  @RegisterInteractionHandler('help', 'prev')
  async handlePrevButton(interaction: ButtonInteraction) {
    await interaction.deferUpdate();

    const currentPage = Number.parseInt(
      CustomID.parseCustomId(interaction.customId).args[0] || '0',
    );
    const newPage = Math.max(0, currentPage - 1);

    const commands = Array.from(interaction.client.commands.values());
    const totalPages = Math.ceil(commands.length / 5);

    const container = await this.createHelpContainer(interaction, newPage, totalPages, commands);

    await interaction.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('help', 'next')
  async handleNextButton(interaction: ButtonInteraction) {
    await interaction.deferUpdate();

    const currentPage = Number.parseInt(
      CustomID.parseCustomId(interaction.customId).args[0] || '0',
    );
    const commands = Array.from(interaction.client.commands.values());
    const totalPages = Math.ceil(commands.length / 5);
    const newPage = Math.min(totalPages - 1, currentPage + 1);

    const container = await this.createHelpContainer(interaction, newPage, totalPages, commands);

    await interaction.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('help', 'details')
  async handleDetailsButton(interaction: ButtonInteraction) {
    await interaction.deferReply({ ephemeral: true });

    // Get the command name from the button's custom ID
    const commandName = CustomID.parseCustomId(interaction.customId).args[0];
    if (!commandName) {
      await interaction.editReply({
        content: `${getEmoji('x_icon', interaction.client)} Command not found.`,
      });
      return;
    }

    // Find the command
    const baseCommand = interaction.client.commands.get(commandName);
    if (!baseCommand) {
      await interaction.editReply({
        content: `${getEmoji('x_icon', interaction.client)} Command \`${commandName}\` not found.`,
      });
      return;
    }

    // Create Components v2 container for command details
    const container = new ContainerBuilder();

    // Add header
    const headerText = new TextDisplayBuilder().setContent(
      `# ${getEmoji('wand_icon', interaction.client)} Command Help: /${commandName}`,
    );
    container.addTextDisplayComponents(headerText);

    // Add command description and usage
    const applicationCommands = await fetchCommands(interaction.client);
    const commandInfo = this.getCommandInfo(baseCommand);
    const commandDetailsText = new TextDisplayBuilder().setContent(
      await this.formatCommandPath(
        commandInfo,
        getEmoji('dot', interaction.client),
        '',
        applicationCommands,
      ),
    );
    container.addTextDisplayComponents(commandDetailsText);

    // Add options if available
    if (baseCommand.options?.length) {
      const optionsText = new TextDisplayBuilder().setContent(
        `## Options\n${baseCommand.options.map((opt) => `\`${opt.name}\` - ${opt.description}`).join('\n')}`,
      );
      container.addTextDisplayComponents(optionsText);
    }

    // Add dashboard button
    const dashboardButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Open Dashboard')
      .setURL(`${Constants.Links.Website}/dashboard`)
      .setEmoji(getEmoji('wand_icon', interaction.client));

    const dashboardSection = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('Need a visual interface? Check out our dashboard:'),
      )
      .setButtonAccessory(dashboardButton);

    container.addSectionComponents(dashboardSection);

    // Send the response
    await interaction.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }
}
