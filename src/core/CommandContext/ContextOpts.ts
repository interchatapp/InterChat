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

import type Context from '#src/core/CommandContext/Context.js';
// eslint-disable-next-line no-duplicate-imports
import type { ValidContextInteractions } from '#src/core/CommandContext/Context.js';
import type PrefixContext from '#src/core/CommandContext/PrefixContext.js';
import { CustomID } from '#src/utils/CustomID.js';
import Logger from '#src/utils/Logger.js';
import {
  ApplicationCommandOptionType,
  ChatInputCommandInteraction,
  ContextMenuCommandInteraction,
  InteractionType,
  Message,
  type Attachment,
  type Channel,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
  type Role,
  type User,
} from 'discord.js';

/**
 * Custom error class for option retrieval errors
 */
export class OptionError extends Error {
  constructor(
    message: string,
    public readonly optionName: string,
  ) {
    super(message);
    this.name = 'OptionError';
  }
}

type SupportedOptionTypes =
  | ApplicationCommandOptionType.String
  | ApplicationCommandOptionType.Number
  | ApplicationCommandOptionType.Boolean
  | ApplicationCommandOptionType.User
  | ApplicationCommandOptionType.Channel
  | ApplicationCommandOptionType.Role
  | ApplicationCommandOptionType.Attachment;

// Mapping from option type to the corresponding method name on ChatInputCommandInteraction.options
const methodMap = new Map([
  [ApplicationCommandOptionType.Integer, 'getInteger'],
  [ApplicationCommandOptionType.String, 'getString'],
  [ApplicationCommandOptionType.Number, 'getNumber'],
  [ApplicationCommandOptionType.Boolean, 'getBoolean'],
  [ApplicationCommandOptionType.User, 'getUser'],
  [ApplicationCommandOptionType.Channel, 'getChannel'],
  [ApplicationCommandOptionType.Role, 'getRole'],
  [ApplicationCommandOptionType.Attachment, 'getAttachment'],
] as const);

/**
 * An interface to abstract the option retrieval.
 */
interface OptionResolver {
  getOption<T>(name: string, type: SupportedOptionTypes, required: boolean): T | null;
}

/**
 * Type guard to check if a context is a PrefixContext
 */
function isPrefixContext(ctx: Context): ctx is PrefixContext {
  return ctx.originalInteraction instanceof Message;
}

/**
 * Type guard to check if an interaction is a ChatInputCommandInteraction
 */
function isChatInputCommandInteraction(interaction: ValidContextInteractions) {
  return (
    interaction.type === InteractionType.ApplicationCommand && interaction.isChatInputCommand()
  );
}

function isContextMenuInteraction(
  interaction: ValidContextInteractions,
): interaction is ContextMenuCommandInteraction {
  return (
    interaction.type === InteractionType.ApplicationCommand &&
    interaction.isMessageContextMenuCommand()
  );
}

/**
 * Type guard to check if an interaction is a MessageComponentInteraction
 */
function isMessageComponentInteraction(
  interaction: ValidContextInteractions,
): interaction is MessageComponentInteraction {
  return interaction.type === InteractionType.MessageComponent;
}

/**
 * Type guard to check if an interaction is a ModalSubmitInteraction
 */
function isModalSubmitInteraction(
  interaction: ValidContextInteractions,
): interaction is ModalSubmitInteraction {
  return interaction.type === InteractionType.ModalSubmit;
}

/**
 * Resolver for prefix (message) based commands.
 */
class MessageOptionResolver implements OptionResolver {
  private readonly ctx: PrefixContext;

  constructor(ctx: PrefixContext) {
    this.ctx = ctx;
  }

  /**
   * Gets an option value from message-based commands
   * @param name The name of the option to retrieve
   * @param type The expected type of the option
   * @param required Whether the option is required
   * @returns The option value or null if not found/incompatible
   * @throws {OptionError} If the option is required but not found
   */
  getOption<T>(name: string, type: SupportedOptionTypes, required: boolean): T | null {
    try {
      this.validateOptionName(name);
      const arg = this.ctx.args.get(name);

      if (required && !arg) {
        throw new OptionError('Missing required option', name);
      }

      if (!arg) return null;

      if (arg.type !== type) {
        Logger.warn(`Type mismatch for option '${name}': expected ${type}, got ${arg.type}`);
        return null;
      }

      return arg.value as T;
    }
    catch (error) {
      if (error instanceof OptionError) throw error;
      Logger.error(`Error retrieving option '${name}'`, error);
      throw new OptionError(`Failed to retrieve option: ${error.message}`, name);
    }
  }

  private validateOptionName(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new OptionError('Option name must be a non-empty string', String(name));
    }
  }
}

/**
 * Resolver for slash commands (ChatInputCommandInteraction).
 */
class ChatInputOptionResolver implements OptionResolver {
  private readonly interaction: ChatInputCommandInteraction;

  constructor(interaction: ChatInputCommandInteraction) {
    this.interaction = interaction;
  }

  /**
   * Gets an option value from slash command interactions
   * @param name The name of the option to retrieve
   * @param type The expected type of the option
   * @param required Whether the option is required
   * @returns The option value or null if not found
   * @throws {OptionError} If the option type is unsupported or other errors occur
   */
  getOption<T>(name: string, type: SupportedOptionTypes, required: boolean): T | null {
    try {
      this.validateOptionName(name);
      const method = methodMap.get(type);

      if (!method) {
        throw new OptionError(`Unsupported option type: ${type}`, name);
      }

      const optionsMethod = this.interaction.options[method] as (
        name: string,
        required: boolean,
      ) => T;

      return optionsMethod.bind(this.interaction.options)(name, required);
    }
    catch (error) {
      if (error instanceof OptionError) throw error;
      Logger.error(`Error retrieving option '${name}'`, error);
      throw new OptionError(`Failed to retrieve option: ${error.message}`, name);
    }
  }

  private validateOptionName(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new OptionError('Option name must be a non-empty string', String(name));
    }
  }
}

class ContextMenuOptionResolver implements OptionResolver {
  private readonly interaction: ContextMenuCommandInteraction;
  constructor(interaction: ContextMenuCommandInteraction) {
    this.interaction = interaction;
  }

  getOption<T>(name: string): T | null {
    // Context menu commands don't support extra options.
    throw new Error(`Context menu commands do not support options like '${name}'`);
  }
}

/**
 * Resolver for component interactions (buttons, select menus, etc.)
 */
class ComponentOptionResolver implements OptionResolver {
  private readonly interaction: MessageComponentInteraction | ModalSubmitInteraction;
  private readonly customId: ReturnType<typeof CustomID.parseCustomId>;

  constructor(interaction: MessageComponentInteraction | ModalSubmitInteraction) {
    this.interaction = interaction;
    this.customId = CustomID.parseCustomId(interaction.customId);
  }

  /**
   * Gets an option value from component interactions
   * For components, options are stored in the customId args
   * @param name The index or name of the argument to retrieve
   * @param type The expected type of the option
   * @param required Whether the option is required
   * @returns The option value or null if not found
   */
  getOption<T>(name: string, type: SupportedOptionTypes, required: boolean): T | null {
    try {
      // If name is a number, treat it as an index
      const index = Number(name);
      if (!isNaN(index) && index >= 0) {
        const value = this.customId.args[index];
        if (required && value === undefined) {
          throw new OptionError(`Missing required argument at index ${index}`, name);
        }
        return this.convertValue(value, type) as T;
      }

      // Otherwise, try to find a named argument in the format "name=value"
      for (const arg of this.customId.args) {
        if (arg.startsWith(`${name}=`)) {
          const value = arg.substring(name.length + 1);
          return this.convertValue(value, type) as T;
        }
      }

      if (required) {
        throw new OptionError(`Missing required argument: ${name}`, name);
      }

      return null;
    }
    catch (error) {
      if (error instanceof OptionError) throw error;
      Logger.error(`Error retrieving option '${name}'`, error);
      throw new OptionError(`Failed to retrieve option: ${error.message}`, name);
    }
  }

  /**
   * Convert a string value to the appropriate type
   * @param value The string value to convert
   * @param type The target type
   * @returns The converted value or null if conversion failed
   */
  private convertValue(value: string | undefined, type: SupportedOptionTypes): unknown {
    if (value === undefined) return null;

    switch (type) {
      case ApplicationCommandOptionType.String:
        return value;
      case ApplicationCommandOptionType.Number:
        const num = Number(value);
        return isNaN(num) ? null : num;
      case ApplicationCommandOptionType.Boolean:
        return value === 'true' || value === '1' || value === 'yes';
      case ApplicationCommandOptionType.User:
      case ApplicationCommandOptionType.Channel:
      case ApplicationCommandOptionType.Role:
        return value;
      default:
        return null;
    }
  }
}

/**
 * The main ContextOptions class that provides a unified interface for retrieving
 * command options across different Discord interaction types.
 */
export default class ContextOptions {
  private resolver: OptionResolver;
  private readonly ctx: Context;

  /**
   * Creates a new ContextOptions instance
   * @param ctx The command context
   * @throws {OptionError} If the interaction type is unsupported
   */
  constructor(ctx: Context) {
    this.ctx = ctx;

    if (isPrefixContext(ctx)) {
      this.resolver = new MessageOptionResolver(ctx);
    }
    else if (isChatInputCommandInteraction(ctx.originalInteraction)) {
      this.resolver = new ChatInputOptionResolver(ctx.originalInteraction);
    }
    else if (isContextMenuInteraction(ctx.originalInteraction)) {
      this.resolver = new ContextMenuOptionResolver(ctx.originalInteraction);
    }
    else if (isMessageComponentInteraction(ctx.originalInteraction) ||
             isModalSubmitInteraction(ctx.originalInteraction)) {
      this.resolver = new ComponentOptionResolver(ctx.originalInteraction);
    }
    else {
      throw new OptionError('Unsupported interaction type for options', 'context_type');
    }
  }

  /**
   * Generic method to retrieve any supported option type
   * @param name The option name
   * @param type The option type
   * @param required Whether the option is required
   * @returns The option value or null if not found/compatible
   * @throws {OptionError} If required option is missing or on retrieval errors
   */
  private getOption<T>(name: string, type: SupportedOptionTypes, required = false): T | null {
    let option;
    try {
      option = this.resolver.getOption<T>(name, type, required);
    }
    catch (error) {
      if (error instanceof OptionError) throw error;
      throw new OptionError(`Option retrieval failed: ${error.message}`, name);
    }

    if (required && option === null) {
      throw new OptionError('Missing required option', name);
    }

    return option;
  }

  /**
   * Gets a string option value
   * @param name The option name
   * @param required Whether the option is required
   * @returns The string value or null if not found
   * @throws {OptionError} If required option is missing
   */
  public getString(name: string, required: true): string;
  public getString(name: string, required?: boolean): string | null;
  public getString(name: string, required = false): string | null {
    const option = this.getOption<string>(name, ApplicationCommandOptionType.String, required);
    return option;
  }

  /**
   * Gets a number option value
   * @param name The option name
   * @param required Whether the option is required
   * @returns The number value or null if not found
   * @throws {OptionError} If required option is missing or value can't be converted to number
   */
  public getNumber(name: string, required: true): number;
  public getNumber(name: string, required?: boolean): number | null;
  public getNumber(name: string, required = false): number | null {
    const value = this.getOption<number>(name, ApplicationCommandOptionType.Number, required);
    if (value !== null && isNaN(Number(value))) {
      throw new OptionError('Value cannot be converted to a number', name);
    }
    return value !== null ? Number(value) : null;
  }

  /**
   * Gets a boolean option value
   * @param name The option name
   * @param required Whether the option is required
   * @returns The boolean value or null if not found
   * @throws {OptionError} If required option is missing
   */
  public getBoolean(name: string, required: true): boolean;
  public getBoolean(name: string, required?: boolean): boolean | null;
  public getBoolean(name: string, required = false): boolean | null {
    return this.getOption<boolean>(name, ApplicationCommandOptionType.Boolean, required);
  }

  /**
   * Gets a user ID from the options
   * @param name The option name
   * @param required Whether the option is required
   * @returns The user ID or null if not found
   * @throws {OptionError} If required option is missing
   */
  public getUserId(name: string, required: true): string;
  public getUserId(name: string, required?: boolean): string | null;
  public getUserId(name: string, required = false): string | null {
    return this.getOption<string>(name, ApplicationCommandOptionType.User, required);
  }

  /**
   * Gets a user object from the options
   * @param name The option name
   * @param required Whether the option is required
   * @returns The user object or null if not found/fetchable
   * @throws {OptionError} If required option is missing
   */
  public async getUser(name: string, required: true): Promise<User>;
  public async getUser(name: string, required?: boolean): Promise<User | null>;
  public async getUser(name: string, required = false): Promise<User | null> {
    try {
      if (isChatInputCommandInteraction(this.ctx.originalInteraction)) {
        const user = this.ctx.originalInteraction.options.getUser(name, required);
        return user;
      }

      const userId = this.getUserId(name, required);
      if (!userId) return null;

      const user = await this.ctx.client.users.fetch(userId).catch((error) => {
        Logger.warn(`Failed to fetch user ${userId}`, error);
        return null;
      });

      return user;
    }
    catch (error) {
      if (error instanceof OptionError) throw error;
      throw new OptionError(`Failed to get user: ${error.message}`, name);
    }
  }

  /**
   * Gets a channel object from the options
   * @param name The option name
   * @param required Whether the option is required
   * @returns The channel object or null if not found/fetchable or not in guild
   * @throws {OptionError} If required option is missing
   */
  public async getChannel(name: string, required = false): Promise<Channel | null> {
    if (!this.ctx.inGuild()) {
      if (required) {
        throw new OptionError('Cannot get channel in DM context', name);
      }
      return null;
    }

    try {
      if (isChatInputCommandInteraction(this.ctx.originalInteraction)) {
        if (!this.ctx.originalInteraction.inCachedGuild()) return null;
        return this.ctx.originalInteraction.options.getChannel(name, required);
      }

      const channelId = this.getOption<string>(
        name,
        ApplicationCommandOptionType.Channel,
        required,
      );

      if (!channelId) return null;

      return await this.ctx.client.channels.fetch(channelId).catch((error) => {
        Logger.warn(`Failed to fetch channel ${channelId}`, error);
        return null;
      });
    }
    catch (error) {
      if (error instanceof OptionError) throw error;
      throw new OptionError(`Failed to get channel: ${error.message}`, name);
    }
  }

  /**
   * Gets a role ID from the options
   * @param name The option name
   * @param required Whether the option is required
   * @returns The role ID or null if not found
   * @throws {OptionError} If required option is missing
   */
  public getRoleId(name: string, required: true): string;
  public getRoleId(name: string, required?: boolean): string | null;
  public getRoleId(name: string, required = false): string | null {
    return this.getOption<string>(name, ApplicationCommandOptionType.Role, required);
  }

  /**
   * Gets a role object from the options
   * @param name The option name
   * @param required Whether the option is required
   * @returns The role object or null if not found/fetchable or not in guild
   * @throws {OptionError} If required option is missing
   */
  public async getRole(name: string, required = false): Promise<Role | null> {
    if (!this.ctx.inGuild()) {
      if (required) {
        throw new OptionError('Cannot get role in DM context', name);
      }
      return null;
    }

    try {
      if (isChatInputCommandInteraction(this.ctx.originalInteraction)) {
        if (!this.ctx.originalInteraction.inCachedGuild()) return null;
        return this.ctx.originalInteraction.options.getRole(name, required);
      }

      const roleId = this.getRoleId(name, required);
      if (!roleId) return null;

      return (await this.ctx.guild?.roles.fetch(roleId)) ?? null;
    }
    catch (error) {
      if (error instanceof OptionError) throw error;
      throw new OptionError(`Failed to get role: ${error.message}`, name);
    }
  }

  /**
   * Gets an attachment from the options
   * @param name The option name
   * @returns The attachment or null if not found
   */
  public getAttachment(name: string): Attachment | null {
    try {
      if (this.ctx.originalInteraction instanceof Message) {
        return this.ctx.originalInteraction.attachments.first() ?? null;
      }

      if (isChatInputCommandInteraction(this.ctx.originalInteraction)) {
        return this.ctx.originalInteraction.options.getAttachment(name) ?? null;
      }

      return null;
    }
    catch (error) {
      throw new OptionError(`Failed to get attachment: ${error.message}`, name);
    }
  }
}
