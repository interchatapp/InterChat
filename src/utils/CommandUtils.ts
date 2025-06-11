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
import InteractionContext from '#src/core/CommandContext/InteractionContext.js';
import PrefixContext from '#src/core/CommandContext/PrefixContext.js';
import type { InteractionFunction } from '#src/decorators/RegisterInteractionHandler.js';
import { InteractionLoader } from '#src/modules/Loaders/InteractionLoader.js';
import { UIComponents, type EmojiKeys } from '#src/utils/DesignSystem.js';
import { handleError } from '#src/utils/Utils.js';
import {
  type ApplicationCommand,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Collection,
  type ContextMenuCommandInteraction,
  type GuildResolvable,
  Message,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} from 'discord.js';

export type CmdInteraction = ChatInputCommandInteraction | ContextMenuCommandInteraction;

export const loadInteractions = async (map: Collection<string, InteractionFunction>) => {
  const loader = new InteractionLoader(map);
  await loader.load();
};

export const fetchCommands = async (client: Client) => await client.application?.commands.fetch();

export const findCommand = (
  name: string,
  commands:
    | Collection<
      string,
      ApplicationCommand<{
        guild: GuildResolvable;
      }>
    >
    | undefined,
) => commands?.find((command) => command.name === name);

function parseArgs(input: string): string[] {
  // Regex to match key-value pairs with optional quotes or standalone arguments
  const regex = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;
  const matches = input.match(regex);

  if (!matches) {
    return [];
  }

  const quoteRegex = /^(?:["'])|(?:["']$)/g;
  // Process matches to handle key-value pairs with quoted values
  return matches.map((match) => {
    // Check if the match is a key-value pair with a quoted value
    if (/[=].+/.test(match)) {
      const [key, value] = match.split('=');
      // Remove surrounding quotes from the value if present
      const cleanedValue = value.replace(quoteRegex, '');
      return `${key}=${cleanedValue}`;
    }
    // Remove surrounding quotes from standalone arguments if present
    return match.replace(quoteRegex, '');
  });
}

export type SubcommandError = {
  type: 'missing_subcommand' | 'invalid_subcommand' | 'missing_nested_subcommand' | 'invalid_nested_subcommand';
  baseCommand: BaseCommand;
  invalidSubcommand?: string;
  validSubcommands?: string[];
  subcommandGroup?: string;
};

// Helper function to extract command name and args from message
function extractCommandFromMessage(
  message: Message,
  aliases: Map<string, string>,
): { commandName: string; originalCommandName: string; prefixArgs: string[] } | null {
  const prefixArgs = parseArgs(message.content.slice('c!'.length));
  const name = prefixArgs.shift()?.toLowerCase();

  if (!name) return null;

  const originalCommandName = name;
  const commandName = aliases.get(name) || name;

  return { commandName, originalCommandName, prefixArgs };
}

// Helper function to handle context menu commands
function handleContextMenuCommand(
  interaction: ContextMenuCommandInteraction,
  commands: Map<string, BaseCommand>,
): { command: BaseCommand | null; prefixArgs: string[]; commandNameFull: string | null } {
  let command: BaseCommand | null = null;

  for (const cmd of commands.values()) {
    if (cmd.types.contextMenu?.name === interaction.commandName) {
      command = cmd;
      break;
    }
  }

  if (!command) {
    return { command: null, prefixArgs: [], commandNameFull: null };
  }

  return { command, prefixArgs: [], commandNameFull: command.name };
}

// Helper function to get subcommand name
function getSubcommandName(
  interactionOrMessage: ChatInputCommandInteraction | AutocompleteInteraction | Message,
  prefixArgs: string[],
): string | undefined {
  return interactionOrMessage instanceof Message
    ? prefixArgs.shift()?.toLowerCase()
    : (interactionOrMessage.options.getSubcommandGroup() ??
       interactionOrMessage.options.getSubcommand());
}

// Helper function to get nested subcommand name
function getNestedSubcommandName(
  interactionOrMessage: ChatInputCommandInteraction | AutocompleteInteraction | Message,
  prefixArgs: string[],
): string | undefined {
  return interactionOrMessage instanceof Message
    ? prefixArgs.shift()?.toLowerCase()
    : (interactionOrMessage as ChatInputCommandInteraction).options.getSubcommand();
}

// Helper function to process subcommands
function processSubcommands(
  command: BaseCommand,
  interactionOrMessage: ChatInputCommandInteraction | AutocompleteInteraction | Message,
  prefixArgs: string[],
  _originalCommandName: string,
): {
    command: BaseCommand | null;
    secondSubcommandName?: string;
    thirdSubcommandName?: string;
    subcommandError?: SubcommandError;
  } {
  if (!command.subcommands) {
    return { command };
  }

  const secondSubcommandName = getSubcommandName(interactionOrMessage, prefixArgs);

  // Missing required subcommand
  if (!secondSubcommandName) {
    return {
      command: null,
      subcommandError: {
        type: 'missing_subcommand',
        baseCommand: command,
        validSubcommands: Object.keys(command.subcommands),
      },
    };
  }

  const subcommand = command.subcommands[secondSubcommandName];

  if (subcommand instanceof BaseCommand) {
    return { command: subcommand, secondSubcommandName };
  }

  if (typeof subcommand === 'object') {
    const thirdSubcommandName = getNestedSubcommandName(interactionOrMessage, prefixArgs);

    // Missing required nested subcommand
    if (!thirdSubcommandName) {
      return {
        command: null,
        secondSubcommandName,
        subcommandError: {
          type: 'missing_nested_subcommand',
          baseCommand: command,
          subcommandGroup: secondSubcommandName,
          validSubcommands: Object.keys(subcommand),
        },
      };
    }

    const nestedSubcommand = subcommand[thirdSubcommandName];
    if (!nestedSubcommand) {
      // Invalid nested subcommand
      return {
        command: null,
        secondSubcommandName,
        thirdSubcommandName,
        subcommandError: {
          type: 'invalid_nested_subcommand',
          baseCommand: command,
          subcommandGroup: secondSubcommandName,
          invalidSubcommand: thirdSubcommandName,
          validSubcommands: Object.keys(subcommand),
        },
      };
    }

    return { command: nestedSubcommand, secondSubcommandName, thirdSubcommandName };
  }

  if (!subcommand) {
    // Invalid subcommand
    return {
      command: null,
      secondSubcommandName,
      subcommandError: {
        type: 'invalid_subcommand',
        baseCommand: command,
        invalidSubcommand: secondSubcommandName,
        validSubcommands: Object.keys(command.subcommands),
      },
    };
  }

  return { command };
}

export function resolveCommand(
  interactionOrMessage:
    | ChatInputCommandInteraction
    | AutocompleteInteraction
    | ContextMenuCommandInteraction
    | Message,
): {
    command: BaseCommand | null;
    prefixArgs: string[];
    commandNameFull: string | null;
    originalCommandName?: string;
    subcommandError?: SubcommandError;
  } {
  const client = interactionOrMessage.client;
  const { commands, aliases } = client;
  let commandName: string;
  let originalCommandName: string;
  let prefixArgs: string[] = [];

  // Handle different interaction types
  if (interactionOrMessage instanceof Message) {
    const result = extractCommandFromMessage(interactionOrMessage, aliases);
    if (!result) return { command: null, prefixArgs, commandNameFull: null };

    ({ commandName, originalCommandName, prefixArgs } = result);
  }
  else if (interactionOrMessage.isContextMenuCommand()) {
    return handleContextMenuCommand(interactionOrMessage, commands);
  }
  else {
    commandName = interactionOrMessage.commandName;
    originalCommandName = commandName;
  }

  let command = commands.get(commandName);
  if (!command) return { command: null, prefixArgs, commandNameFull: null };

  // Process subcommands
  const subcommandResult = processSubcommands(
    command,
    interactionOrMessage,
    prefixArgs,
    originalCommandName,
  );

  if (subcommandResult.subcommandError) {
    return {
      command: null,
      prefixArgs,
      commandNameFull: null,
      originalCommandName,
      subcommandError: subcommandResult.subcommandError,
    };
  }

  command = subcommandResult.command!;
  const { secondSubcommandName, thirdSubcommandName } = subcommandResult;

  return {
    command,
    prefixArgs,
    commandNameFull: `${originalCommandName}${secondSubcommandName ? ` ${secondSubcommandName}` : ''}${thirdSubcommandName ? ` ${thirdSubcommandName}` : ''}`,
    originalCommandName,
    subcommandError: undefined,
  };
}

/**
 * Generate help for missing subcommand error
 */
function generateMissingSubcommandHelp(
  baseCommand: BaseCommand,
  client: Client,
  originalCommandName: string,
  _validSubcommands: string[],
): ContainerBuilder {
  return generateUnifiedCommandHelp(baseCommand, client, {
    originalCommandName,
    commandNameFull: `${originalCommandName} <subcommand>`,
    showSubcommands: true,
  });
}

/**
 * Generate help for invalid subcommand error
 */
function generateInvalidSubcommandHelp(
  baseCommand: BaseCommand,
  client: Client,
  originalCommandName: string,
  invalidSubcommand: string,
  _validSubcommands: string[],
): ContainerBuilder {
  return generateUnifiedCommandHelp(baseCommand, client, {
    originalCommandName,
    commandNameFull: `${originalCommandName} <subcommand>`,
    showSubcommands: true,
    errorContext: `Subcommand '${invalidSubcommand}' not recognized`,
    icon: 'x_icon',
  });
}

/**
 * Generate help for missing nested subcommand error
 */
function generateMissingNestedSubcommandHelp(
  baseCommand: BaseCommand,
  client: Client,
  originalCommandName: string,
  subcommandGroup: string,
  validSubcommands: string[],
): ContainerBuilder {
  const ui = new UIComponents(client);
  const container = new ContainerBuilder();

  // Add header
  container.addTextDisplayComponents(
    ui.createHeader(`Command: c!${originalCommandName} ${subcommandGroup}`, baseCommand.description, 'info_icon'),
  );

  ui.addSeparator(container);

  // Build help content
  let helpContent = '## Usage\n';
  helpContent += `\`c!${originalCommandName} ${subcommandGroup} <subcommand>\`\n\n`;

  // Add subcommands section
  helpContent += `## Available ${subcommandGroup} Subcommands\n`;
  const subcommandObj = baseCommand.subcommands![subcommandGroup] as Record<string, BaseCommand>;
  for (const subcommandName of validSubcommands) {
    const subcommand = subcommandObj[subcommandName];
    helpContent += `- \`${subcommandName}\` - ${subcommand.description}\n`;
  }

  // Add examples section
  helpContent += '\n## Examples\n';
  helpContent += validSubcommands.slice(0, 3).map((sub) => `- \`c!${originalCommandName} ${subcommandGroup} ${sub}\``).join('\n');

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(helpContent));
  return container;
}

/**
 * Generate help for invalid nested subcommand error
 */
function generateInvalidNestedSubcommandHelp(
  baseCommand: BaseCommand,
  client: Client,
  originalCommandName: string,
  subcommandGroup: string,
  invalidSubcommand: string,
  validSubcommands: string[],
): ContainerBuilder {
  const ui = new UIComponents(client);
  const container = new ContainerBuilder();

  // Add header with error indicator
  container.addTextDisplayComponents(
    ui.createHeader(`Command: c!${originalCommandName} ${subcommandGroup}`, baseCommand.description, 'x_icon'),
  );

  ui.addSeparator(container);

  // Build help content
  let helpContent = `❌ **Error**: Subcommand '${invalidSubcommand}' not recognized in '${subcommandGroup}'\n\n`;

  helpContent += '## Usage\n';
  helpContent += `\`c!${originalCommandName} ${subcommandGroup} <subcommand>\`\n\n`;

  // Add valid subcommands section
  helpContent += `## Valid ${subcommandGroup} Subcommands\n`;
  const subcommandObj = baseCommand.subcommands![subcommandGroup] as Record<string, BaseCommand>;
  for (const subcommandName of validSubcommands) {
    const subcommand = subcommandObj[subcommandName];
    helpContent += `- \`${subcommandName}\` - ${subcommand.description}\n`;
  }

  // Add examples section
  helpContent += '\n## Examples\n';
  helpContent += validSubcommands.slice(0, 3).map((sub) => `- \`c!${originalCommandName} ${subcommandGroup} ${sub}\``).join('\n');

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(helpContent));
  return container;
}

/**
 * Generate help for specific subcommand with invalid arguments
 */
function generateSubcommandArgumentHelp(
  command: BaseCommand,
  client: Client,
  commandNameFull: string,
): ContainerBuilder {
  return generateUnifiedCommandHelp(command, client, {
    commandNameFull,
  });
}

/**
 * Build usage syntax for a command
 */
function buildUsageSyntax(
  command: BaseCommand,
  fullDisplayName: string,
  showPrefix: boolean,
): string {
  let usageSyntax: string;

  if (showPrefix === false) {
    // Slash command format
    usageSyntax = `/${fullDisplayName}`;
  }
  else {
    // Prefix command format
    const prefix = 'c!';
    usageSyntax = `${prefix}${fullDisplayName}`;
  }

  // Add parameters to usage syntax
  if (command.options && command.options.length > 0) {
    for (const option of command.options) {
      if (option.required) {
        usageSyntax += ` <${option.name}>`;
      }
      else {
        usageSyntax += ` [${option.name}]`;
      }
    }
  }

  return usageSyntax;
}

/**
 * Build parameters section content
 */
function buildParametersSection(command: BaseCommand): string {
  if (!command.options || command.options.length === 0) {
    return '';
  }

  let content = '\n## Parameters\n';
  for (const option of command.options) {
    const required = option.required ? '(required)' : '(optional)';
    content += `• \`${option.name}\`: ${option.description} ${required}\n`;
  }
  return content;
}

/**
 * Build subcommands section content
 */
function buildSubcommandsSection(command: BaseCommand, showSubcommands: boolean): string {
  const hasSubcommands = command.subcommands && Object.keys(command.subcommands).length > 0;
  if (!showSubcommands || !hasSubcommands) {
    return '';
  }

  let content = '\n## Subcommands\n';
  for (const [name, subCmd] of Object.entries(command.subcommands!)) {
    if (subCmd instanceof BaseCommand) {
      content += `• \`${name}\` - ${subCmd.description}\n`;
    }
    else {
      const nestedCommands = Object.keys(subCmd);
      content += `• \`${name}\` - Group with: ${nestedCommands.join(', ')}\n`;
    }
  }
  return content;
}

/**
 * Build examples section content
 */
function buildExamplesSection(command: BaseCommand): string {
  if (!command.examples || command.examples.length === 0) {
    return '';
  }

  let content = '\n## Examples\n';
  content += command.examples.map((example) => `• \`${example}\``).join('\n');
  return content;
}

/**
 * Build aliases section content
 */
function buildAliasesSection(command: BaseCommand, showPrefix: boolean): string {
  if (!command.aliases || command.aliases.length === 0) {
    return '';
  }

  let content = '\n\n## Aliases\n';
  const aliasPrefix = showPrefix === false ? '/' : 'c!';
  content += command.aliases.map((alias) => `• \`${aliasPrefix}${alias}\``).join('\n');
  return content;
}

/**
 * Unified command help generation function
 * Used by both validation errors and help command for consistency
 */
export function generateUnifiedCommandHelp(
  command: BaseCommand,
  client: Client,
  options: {
    originalCommandName?: string;
    commandNameFull?: string;
    showPrefix?: boolean;
    showBackButtons?: boolean;
    showSubcommands?: boolean;
    errorContext?: string;
    icon?: EmojiKeys;
  } = {},
): ContainerBuilder {
  const ui = new UIComponents(client);
  const container = new ContainerBuilder();

  // Determine display name and format
  const displayName = options.originalCommandName || command.name;
  const prefix = options.showPrefix !== false ? 'c!' : '';
  const fullDisplayName = options.commandNameFull || displayName;
  const headerTitle = `Command: ${prefix}${fullDisplayName}`;

  // Add header with appropriate icon
  const iconName = options.icon || (options.errorContext ? 'x_icon' : 'info_icon');
  container.addTextDisplayComponents(
    ui.createHeader(headerTitle, command.description, iconName),
  );

  ui.addSeparator(container);

  // Build help content using helper functions
  let helpContent = '';

  // Add error context if provided
  if (options.errorContext) {
    helpContent += `❌ **Error**: ${options.errorContext}\n\n`;
  }

  // Add usage section
  helpContent += '## Usage\n';
  const usageSyntax = buildUsageSyntax(command, fullDisplayName, options.showPrefix !== false);
  helpContent += `\`${usageSyntax}\`\n`;

  // Add other sections using helper functions
  helpContent += buildParametersSection(command);
  helpContent += buildSubcommandsSection(command, options.showSubcommands || false);
  helpContent += buildExamplesSection(command);
  helpContent += buildAliasesSection(command, options.showPrefix !== false);

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(helpContent));

  return container;
}

/**
 * Generate contextual help for a command (legacy wrapper)
 * @param command The command to generate help for
 * @param client The Discord client
 * @param originalCommandName The original command name used (could be an alias)
 * @returns A container with the command help
 */
function generateCommandHelp(
  command: BaseCommand,
  client: Client,
  originalCommandName?: string,
): ContainerBuilder {
  return generateUnifiedCommandHelp(command, client, {
    originalCommandName,
    showSubcommands: true,
  });
}

async function validatePrefixCommand(
  ctx: PrefixContext,
  command: BaseCommand,
  message: Message,
  originalCommandName?: string,
  subcommandError?: SubcommandError,
  commandNameFull?: string,
) {
  // Handle subcommand errors first
  if (subcommandError) {
    let helpContainer: ContainerBuilder;

    switch (subcommandError.type) {
      case 'missing_subcommand':
        helpContainer = generateMissingSubcommandHelp(
          subcommandError.baseCommand,
          message.client,
          originalCommandName!,
          subcommandError.validSubcommands!,
        );
        break;

      case 'invalid_subcommand':
        helpContainer = generateInvalidSubcommandHelp(
          subcommandError.baseCommand,
          message.client,
          originalCommandName!,
          subcommandError.invalidSubcommand!,
          subcommandError.validSubcommands!,
        );
        break;

      case 'missing_nested_subcommand':
        helpContainer = generateMissingNestedSubcommandHelp(
          subcommandError.baseCommand,
          message.client,
          originalCommandName!,
          subcommandError.subcommandGroup!,
          subcommandError.validSubcommands!,
        );
        break;

      case 'invalid_nested_subcommand':
        helpContainer = generateInvalidNestedSubcommandHelp(
          subcommandError.baseCommand,
          message.client,
          originalCommandName!,
          subcommandError.subcommandGroup!,
          subcommandError.invalidSubcommand!,
          subcommandError.validSubcommands!,
        );
        break;

      default:
        // Fallback to basic help
        helpContainer = generateCommandHelp(
          subcommandError.baseCommand,
          message.client,
          originalCommandName,
        );
    }

    await ctx.reply({
      components: [helpContainer],
      flags: [MessageFlags.IsComponentsV2],
    });
    return false;
  }

  // Handle invalid arguments for valid subcommands
  if (!ctx.isValid) {
    let helpContainer: ContainerBuilder;

    // If we have a full command name, this is a subcommand with invalid arguments
    if (commandNameFull && commandNameFull.includes(' ')) {
      helpContainer = generateSubcommandArgumentHelp(command, message.client, commandNameFull);
    }
    else {
      // Regular command with invalid arguments
      helpContainer = generateCommandHelp(command, message.client, originalCommandName);
    }

    await ctx.reply({
      components: [helpContainer],
      flags: [MessageFlags.IsComponentsV2],
    });
    return false;
  }

  if (command.defaultPermissions && message.inGuild()) {
    if (!message.member?.permissions.has(command.defaultPermissions, true)) {
      await message.reply(
        `You do not have the required permissions to use this command. Required permissions: \`${command.defaultPermissions}\`.`,
      );
      return false;
    }
  }

  return true;
}

export async function executeCommand(
  interactionOrMessage: Message | ChatInputCommandInteraction | ContextMenuCommandInteraction,
  { command, ...opts }: {
    command: BaseCommand | null;
    prefixArgs?: string[];
    commandNameFull?: string | null;
    originalCommandName?: string;
    subcommandError?: SubcommandError;
  },
) {
  // Handle subcommand errors even when command is null
  if (opts.subcommandError && interactionOrMessage instanceof Message) {
    const ctx = new PrefixContext(
      interactionOrMessage,
      opts.subcommandError.baseCommand,
      opts.prefixArgs ?? [],
    );
    await validatePrefixCommand(
      ctx,
      opts.subcommandError.baseCommand,
      interactionOrMessage,
      opts.originalCommandName,
      opts.subcommandError,
      opts.commandNameFull || undefined,
    );
    return;
  }

  if (!command) return;

  let ctx: PrefixContext | InteractionContext;
  if (interactionOrMessage instanceof Message) {
    ctx = new PrefixContext(interactionOrMessage, command, opts.prefixArgs ?? []);
    const isValid = await validatePrefixCommand(
      ctx,
      command,
      interactionOrMessage,
      opts.originalCommandName,
      undefined,
      opts.commandNameFull || undefined,
    );
    if (!isValid) return;
  }
  else {
    ctx = new InteractionContext(interactionOrMessage, command);
  }

  try {
    if (command.execute) await command.execute(ctx);
  }
  catch (error) {
    handleError(error, { repliable: interactionOrMessage });
  }

  // Send metrics to cluster manager
  ctx.client.shardMetrics.incrementCommand(opts.commandNameFull ?? command.name);
}
