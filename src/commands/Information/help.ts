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
import { Pagination } from '#src/modules/Pagination.js';
import { fetchCommands } from '#src/utils/CommandUtils.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import {
  ApplicationCommandOptionType,
  chatInputApplicationCommandMention,
  Collection,
  AutocompleteInteraction,
  ApplicationCommand,
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

      const commandInfo = this.getCommandInfo(command);
      const embed = new InfoEmbed()
        .setTitle(`${ctx.getEmoji('wand_icon')} Command Help`)
        .setDescription(
          await this.formatCommandPath(
            commandInfo,
            ctx.getEmoji('dot'),
            commandPath.slice(0, -1).join(' '),
            applicationCommands,
          ),
        )
        .setFooter({
          text: 'Tip: Click on a command to use it!',
          iconURL: ctx.client.user.displayAvatarURL(),
        });

      if (command.options?.length) {
        embed.addFields({
          name: 'Options',
          value: command.options.map((opt) => `\`${opt.name}\` - ${opt.description}`).join('\n'),
        });
      }

      await ctx.reply({ embeds: [embed] });
      return;
    }

    const commands = Array.from(ctx.client.commands.values());
    const commandsPerPage = 5;
    const pages = [];
    const totalPages = Math.ceil(commands.length / commandsPerPage);

    for (let i = 0; i < commands.length; i += commandsPerPage) {
      const pageNumber = Math.floor(i / commandsPerPage) + 1;
      const pageCommands = commands.slice(i, i + commandsPerPage);
      const embed = new InfoEmbed()
        .setTitle('InterChat Commands')
        .setThumbnail(ctx.client.user.displayAvatarURL())
        .setDescription(
          `Welcome to InterChat's help menu! Below you'll find all available commands.\n${(
            await Promise.all(
              pageCommands.map((cmd) =>
                this.formatCommandPath(
                  this.getCommandInfo(cmd),
                  ctx.getEmoji('dot'),
                  '',
                  applicationCommands,
                ),
              ),
            )
          ).join('')}`,
        )
        .setFooter({
          text: `Page ${pageNumber}/${totalPages} • Click on a command to use it!`,
          iconURL: ctx.client.user.displayAvatarURL(),
        });

      pages.push({ embeds: [embed] });
    }

    new Pagination(ctx.client).addPages(pages).run(ctx);
  }
}
