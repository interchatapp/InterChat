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
import type Context from '#src/core/CommandContext/Context.js';
import type PrefixContext from '#src/core/CommandContext/PrefixContext.js';
import {
  ApplicationCommandOptionType,
  ChatInputCommandInteraction,
  Message,
  type Channel,
} from 'discord.js';

export default class ContextOptions {
  readonly ctx: Context;
  readonly command: BaseCommand;

  constructor(ctx: Context, command: BaseCommand) {
    this.ctx = ctx;
    this.command = command;
  }

  private getOption<T extends string | number | boolean>(
    name: string,
    expectedType: ApplicationCommandOptionType,
    required = false,
  ): T | null {
    if (this.ctx.originalInteraction instanceof Message) {
      const arg = (this.ctx as PrefixContext).args.get(name);

      if (required && !arg) {
        throw new Error(`Missing required option: ${name}`);
      }

      // Type safety enforced by PrefixContext parsing
      return arg?.type === expectedType ? (arg.value as T) : null;
    }

    if (this.ctx.originalInteraction.isChatInputCommand()) {
      return this.ctx.originalInteraction.options.getString(
        name,
        required,
      ) as T;
    }

    throw new Error(`Cannot get ${expectedType} option from context menu`);
  }

  // Simplified type-specific methods
  public getString(name: string, required: true): string;
  public getString(name: string, required?: boolean): string | null;
  public getString(name: string, required = false) {
    return this.getOption(
      name,
      ApplicationCommandOptionType.String,
      required,
    ) as string;
  }

  public getNumber(name: string, required = false): number | null {
    const value = this.getOption(
      name,
      ApplicationCommandOptionType.Number,
      required,
    );
    return value ? Number(value) : null;
  }

  public getBoolean(name: string, required = false): boolean | null {
    const value = this.getOption(
      name,
      ApplicationCommandOptionType.Boolean,
      required,
    );
    return value !== null ? (value as boolean) : null;
  }

  // User-related methods
  public getUserId(name: string, required = false): string | null {
    return this.getOption<string>(
      name,
      ApplicationCommandOptionType.User,
      required,
    );
  }

  public async getUser(name: string, required = false) {
    if (this.ctx.originalInteraction instanceof ChatInputCommandInteraction) {
      return this.ctx.originalInteraction.options.getUser(name, required);
    }

    const userId = this.getUserId(name, required);
    if (!userId) return null;
    return await this.ctx.client.users.fetch(userId).catch(() => null);
  }

  // Channel methods
  public async getChannel(
    name: string,
    required = false,
  ): Promise<Channel | null> {
    if (!this.ctx.inGuild()) return null;

    if (this.ctx.originalInteraction instanceof ChatInputCommandInteraction) {
      return this.ctx.originalInteraction.options.getChannel(name, required);
    }

    const channelId = this.getOption<string>(
      name,
      ApplicationCommandOptionType.Channel,
      required,
    );
    if (!channelId) return null;
    return await this.ctx.client.channels.fetch(channelId).catch(() => null);
  }

  // Role methods
  public getRoleId(name: string, required = false): string | null {
    return this.getOption(name, ApplicationCommandOptionType.Role, required);
  }

  public async getRole(name: string, required = false) {
    if (!this.ctx.inGuild()) return null;
    if (this.ctx.originalInteraction instanceof ChatInputCommandInteraction) {
      return this.ctx.originalInteraction.options.getRole(name, required);
    }
    const roleId = this.getRoleId(name, required);
    return roleId ? (await this.ctx.guild?.roles.fetch(roleId) ?? null) : null;
  }

  // Attachment handling
  public getAttachment(name: string) {
    if (this.ctx.originalInteraction instanceof Message) {
      return this.ctx.originalInteraction.attachments.first() ?? null;
    }
    if (this.ctx.originalInteraction.isChatInputCommand()) {
      return this.ctx.originalInteraction.options.getAttachment(name) ?? null;
    }
    return null;
  }
}
