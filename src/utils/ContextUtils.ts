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

import type BaseCommand from '#src/core/BaseCommand.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import InteractionContext from '#src/core/CommandContext/InteractionContext.js';
import PrefixContext from '#src/core/CommandContext/PrefixContext.js';
import type {
  ChatInputCommandInteraction,
  ContextMenuCommandInteraction,
  Message,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from 'discord.js';

/**
 * Create a context object from a message
 * @param message The message to create a context from
 * @param command The command associated with this context
 * @param args The command arguments
 * @returns A PrefixContext instance
 */
export function createPrefixContext(
  message: Message,
  command: BaseCommand,
  args: string[],
): PrefixContext {
  return new PrefixContext(message, command, args);
}

/**
 * Create a context object from a slash command or context menu interaction
 * @param interaction The interaction to create a context from
 * @param command The command associated with this context
 * @returns An InteractionContext instance
 */
export function createInteractionContext(
  interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction,
  command: BaseCommand,
): InteractionContext {
  return new InteractionContext(interaction, command);
}

/**
 * Create a context object from a component interaction
 * @param interaction The interaction to create a context from
 * @param command The command associated with this context (optional)
 * @returns A ComponentContext instance
 */
export function createComponentContext(
  interaction: MessageComponentInteraction | ModalSubmitInteraction,
  command?: BaseCommand,
): ComponentContext {
  return new ComponentContext(interaction, command);
}
