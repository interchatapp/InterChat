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
} from 'discord.js';

export type CmdInteraction =
	| ChatInputCommandInteraction
	| ContextMenuCommandInteraction;

export const loadInteractions = async (
  map: Collection<string, InteractionFunction>,
) => {
  const loader = new InteractionLoader(map);
  await loader.load();
};

export const fetchCommands = async (client: Client) =>
  await client.application?.commands.fetch();

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

export function resolveCommand(
  interactionOrMessage:
		| ChatInputCommandInteraction
		| AutocompleteInteraction
		| ContextMenuCommandInteraction
		| Message,
): { command: BaseCommand | null; prefixArgs: string[] } {
  const { commands } = interactionOrMessage.client;
  let commandName: string;
  let prefixArgs: string[] = [];

  if (interactionOrMessage instanceof Message) {
    prefixArgs = parseArgs(interactionOrMessage.content.slice('c!'.length));

    const name = prefixArgs.shift()?.toLowerCase();
    if (!name) return { command: null, prefixArgs };

    commandName = name;
  }
  else if (interactionOrMessage.isContextMenuCommand()) {
    const command = commands.find(
      (cmd) => cmd.types.contextMenu?.name === interactionOrMessage.commandName,
    );
    if (!command) return { command: null, prefixArgs };
    return { command, prefixArgs };
  }
  else {
    commandName = interactionOrMessage.commandName;
  }

  let command = commands.get(commandName);
  if (!command) return { command: null, prefixArgs };

  if (command.subcommands) {
    /** Slash command visualization: `/<command>` ***`<subcommand2>`*** `<subcommand3>` */
    const secondSubcommandName =
			interactionOrMessage instanceof Message
			  ? prefixArgs.shift()?.toLowerCase()
			  : (interactionOrMessage.options.getSubcommandGroup() ??
					interactionOrMessage.options.getSubcommand());

    if (!secondSubcommandName) return { command: null, prefixArgs };

    const subcommand = command.subcommands[secondSubcommandName];
    if (subcommand instanceof BaseCommand) {
      command = subcommand;
    }
    else if (typeof subcommand === 'object') {
      /** Slash command visualization: `/<command>` `<subcommand2>` ***`<subcommand3>`*** */
      const thirdSubcommandName =
				interactionOrMessage instanceof Message
				  ? prefixArgs.shift()?.toLowerCase()
				  : (
				    interactionOrMessage as ChatInputCommandInteraction
				  ).options.getSubcommand();

      if (!thirdSubcommandName) return { command: null, prefixArgs };

      command = subcommand[thirdSubcommandName];
    }
  }

  return { command, prefixArgs };
}

async function validatePrefixCommand(
  ctx: PrefixContext,
  command: BaseCommand,
  message: Message,
) {
  if (!ctx.isValid) {
    await ctx.reply(
      `${ctx.getEmoji('x_icon')} Invalid arguments provided. Use \`help\` command to see the command usage.`,
    );
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
  interactionOrMessage:
		| Message
		| ChatInputCommandInteraction
		| ContextMenuCommandInteraction,
  command: BaseCommand | undefined,
  prefixArgs: string[] = [],
) {
  if (!command) return;

  let ctx: PrefixContext | InteractionContext;
  if (interactionOrMessage instanceof Message) {
    ctx = new PrefixContext(interactionOrMessage, command, prefixArgs);
    if (!(await validatePrefixCommand(ctx, command, interactionOrMessage))) return;
  }
  else {
    ctx = new InteractionContext(interactionOrMessage, command);
  }

  try {
    if (command.execute) await command.execute(ctx);
  }
  catch (e) {
    handleError(e, { repliable: interactionOrMessage });
  }
}
