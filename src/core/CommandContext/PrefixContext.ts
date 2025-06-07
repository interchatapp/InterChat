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
import Context from '#src/core/CommandContext/Context.js';
import Logger from '#src/utils/Logger.js';
import { extractUserId, extractChannelId, extractRoleId } from '#src/utils/Utils.js';
import {
  type APIApplicationCommandBasicOption,
  type APIModalInteractionResponseCallbackData,
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  Collection,
  ComponentType,
  type JSONEncodable,
  type Message,
  type MessageEditOptions,
  type MessageReplyOptions,
  type ModalComponentData,
} from 'discord.js';

const acceptedBooleanValues = {
  true: true,
  false: false,
  yes: true,
  no: false,
  y: true,
  n: false,
};

export default class PrefixContext extends Context<{
  interaction: Message;
  responseType: Message;
}> {
  private lastReply: Message | null = null;
  private _deferred = false;
  private argumentValidationPassed = true;

  private readonly _args: Collection<
    string,
    {
      value: string | number | boolean | null;
      type: ApplicationCommandOptionType;
    }
  >;

  constructor(message: Message, command: BaseCommand, input: string[]) {
    super(message, command);

    // Split arguments with quote handling
    const commandOptions = new Map(
      Object.entries(command.options).map(([, option]) => [option.name, option]),
    );

    // Store parsed arguments with resolved values
    this._args = this.parseArguments(input, commandOptions) ?? new Collection();
  }

  public get isValid() {
    return this.argumentValidationPassed;
  }

  private parseArguments(
    rawArgs: string[],
    definedOpts: Map<string, APIApplicationCommandBasicOption>,
  ): Collection<
    string,
    {
      value: string | number | boolean | null;
      type: ApplicationCommandOptionType;
    }
  > | null {
    const args = new Collection<
      string,
      {
        value: string | number | boolean | null;
        type: ApplicationCommandOptionType;
      }
    >();
    // First process named arguments
    for (const arg of rawArgs) {
      if (arg.includes('=')) {
        const [name, ...valueParts] = arg.split('=');
        const value = valueParts.join('=');
        const option = definedOpts.get(name.trim());

        if (!option) {
          this.argumentValidationPassed = false;
          Logger.error(`Unknown option: ${name}`);
          return null;
        }

        if (!value && option.required) {
          this.argumentValidationPassed = false;
          Logger.error(`Missing required option: ${option.name}`);
          return null;
        }

        if (value) {
          const parsed = this.processArg(value, option.type);
          if (parsed === null) {
            this.argumentValidationPassed = false;
            Logger.error(`Invalid value for ${name}`);
            return null;
          }
          args.set(option.name, { value: parsed, type: option.type });
          definedOpts.delete(option.name);
          rawArgs.splice(rawArgs.indexOf(arg), 1);
        }
      }
    }

    // Then process positional arguments
    const commandOptionsArray = Array.from(definedOpts.values());
    for (let i = 0; i < commandOptionsArray.length; i++) {
      const value = rawArgs.at(i);
      const option = commandOptionsArray.at(i);

      if (!option) {
        this.argumentValidationPassed = false;
        Logger.error(`Unknown option: ${value}`);
        return null;
      }

      if (!value && option.required) {
        this.argumentValidationPassed = false;
        Logger.error(`Missing required option: ${option.name}`);
        return null;
      }

      if (value) {
        const parsed = this.processArg(value, option.type);
        if (parsed === null) {
          this.argumentValidationPassed = false;
          Logger.error(`Invalid value for ${value}`);
          return null;
        }
        args.set(option.name, { value: parsed, type: option.type });
      }
    }

    return args;
  }

  private processArg(arg: string, type: ApplicationCommandOptionType) {
    switch (type) {
      case ApplicationCommandOptionType.String:
        return arg;
      case ApplicationCommandOptionType.User:
        return extractUserId(arg);
      case ApplicationCommandOptionType.Channel:
        return extractChannelId(arg);
      case ApplicationCommandOptionType.Role:
        return extractRoleId(arg);
      case ApplicationCommandOptionType.Number: {
        const num = Number(arg);
        return Number.isNaN(num) ? null : num;
      }
      case ApplicationCommandOptionType.Boolean: {
        const key = arg.toLowerCase() as keyof typeof acceptedBooleanValues;
        return key in acceptedBooleanValues ? acceptedBooleanValues[key] : null;
      }
      default:
        return null;
    }
  }

  public get args() {
    return this._args;
  }

  public get deferred() {
    return this._deferred;
  }
  public get replied() {
    return Boolean(this.lastReply);
  }

  public async reply(data: string | MessageReplyOptions) {
    this.lastReply = await this.interaction.reply(
      typeof data === 'string' ? { content: data } : { ...data, content: data.content ?? '' },
    );
    return this.lastReply;
  }

  public async deleteReply() {
    await this.lastReply?.delete();
  }

  public async deferReply() {
    this._deferred = true;
    this.lastReply = await this.interaction.reply('Processing...');
    return this.lastReply;
  }

  public async editReply(data: string | MessageEditOptions) {
    if (!this.lastReply) return null;

    if (typeof data === 'string') {
      return await this.lastReply.edit(data);
    }
    return await this.lastReply.edit({ ...data });
  }

  public async showModal(
    modal:
      | JSONEncodable<APIModalInteractionResponseCallbackData>
      | ModalComponentData
      | APIModalInteractionResponseCallbackData,
  ) {
    const reply = await this.reply({
      content: 'Click button to enter data.',
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId('openForm')
            .setLabel('Open Form')
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });

    const collector = reply?.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i) => i.customId === 'openForm' && i.user.id === this.interaction.author.id,
      idle: 60000,
    });

    collector?.on('collect', async (i) => {
      await i.showModal(modal);
    });
  }
}
