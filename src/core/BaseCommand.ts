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
import {
  type APIApplicationCommandBasicOption,
  ApplicationCommandOptionType,
  type ApplicationCommandType,
  ApplicationIntegrationType,
  type AutocompleteInteraction,
  ContextMenuCommandBuilder,
  InteractionContextType,
  type PermissionsBitField,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type RESTPostAPIContextMenuApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from 'discord.js';
import isEmpty from 'lodash/isEmpty.js';

interface Config {
  name: string;
  description: string;
  staffOnly?: boolean;
  contexts?: { guildOnly?: boolean; userInstall?: boolean };
  options?: APIApplicationCommandBasicOption[];
  defaultPermissions?: PermissionsBitField;
}

export interface CommandConfig extends Config {
  types: {
    slash?: boolean;
    prefix?: boolean;
    contextMenu?: never;
  };
  subcommands?: Record<string, BaseCommand | Record<string, BaseCommand>>;
}

interface ContextMenuConfig extends Config {
  types: {
    slash?: boolean;
    prefix?: boolean;
    contextMenu: {
      name: string;
      type: ApplicationCommandType.Message | ApplicationCommandType.User;
    };
  };
  subcommands?: never;
}

export default abstract class BaseCommand {
  readonly name: Config['name'];
  readonly description: Config['description'];
  readonly types: CommandConfig['types'] | ContextMenuConfig['types'];
  readonly contexts: Config['contexts'];
  readonly defaultPermissions: Config['defaultPermissions'];
  readonly staffOnly: boolean;

  // if contextMenu has been set to "Message" options should only contain one sring option
  // which is assumed to be the id of the target message
  // same thing for user ctx menu, user option must be used
  readonly options: APIApplicationCommandBasicOption[];
  readonly subcommands: CommandConfig['subcommands'];

  constructor(opts: ContextMenuConfig | CommandConfig) {
    this.name = opts.name;
    this.description = opts.description;
    this.types = opts.types;
    this.contexts = opts.contexts;
    this.options = opts.options || [];
    this.subcommands = 'subcommands' in opts ? opts.subcommands : undefined;
    this.defaultPermissions = opts.defaultPermissions;
    this.staffOnly = opts.staffOnly || false;
  }

  async execute?(ctx: Context): Promise<void>;
  async autocomplete?(interaction: AutocompleteInteraction): Promise<void>;

  getData() {
    let slashCommand: RESTPostAPIChatInputApplicationCommandsJSONBody | null =
			null;
    let prefixCommand: Omit<CommandConfig, 'types'> | null = null;
    let contextMenu: RESTPostAPIContextMenuApplicationCommandsJSONBody | null =
			null;

    if (this.options.length > 0 && !isEmpty(this.subcommands)) {
      throw new Error(
        `Command "${this.name}" is invalid. A command must either have subcommands or options. Not both.`,
      );
    }


    if (this.types.slash) {
      slashCommand = new SlashCommandBuilder()
        .setName(this.name)
        .setDescription(this.description)
        .setDefaultMemberPermissions(this.defaultPermissions?.toJSON())
        .setIntegrationTypes(
          this.contexts?.userInstall
            ? [ApplicationIntegrationType.UserInstall, ApplicationIntegrationType.GuildInstall]
            : [ApplicationIntegrationType.GuildInstall],
        )
        .toJSON();

      if (!isEmpty(this.options)) {
        slashCommand.options = this.options;
      }
      if (this.contexts?.guildOnly) {
        slashCommand.contexts?.push(InteractionContextType.Guild);
      }

      if (!isEmpty(this.subcommands)) {
        Object.entries(this.subcommands).forEach(([name, data]) => {
          if (data instanceof BaseCommand) {
            slashCommand?.options?.push({
              type: ApplicationCommandOptionType.Subcommand,
              name: data.name,
              description: data.description,
              options: data.options,
            });
          }
          else {
            const subcommandGroupName = name;
            slashCommand?.options?.push({
              type: ApplicationCommandOptionType.SubcommandGroup,
              name: subcommandGroupName,
              description: 'placeholder',
              options: Object.entries(data).map(
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                ([_subcommandName, subcommandData]) => ({
                  type: ApplicationCommandOptionType.Subcommand,
                  name: subcommandData.name,
                  description: subcommandData.description,
                  options: subcommandData.options,
                }),
              ),
            });
          }
        });
      }
    }
    if (this.types.prefix) {
      prefixCommand = {
        name: this.name,
        description: this.description,
        options: this.options,
        subcommands: this.subcommands,
        contexts: this.contexts,
      };
    }
    if (this.types.contextMenu) {
      const { contextMenu: rawCtxData } = this.types;
      contextMenu = new ContextMenuCommandBuilder()
        .setName(rawCtxData.name)
        .setType(rawCtxData.type)
        .toJSON();
    }

    return { prefix: prefixCommand, contextMenu, slash: slashCommand };
  }

  // TODO implement cooldowns
  // protected async clearCooldown(
  //   userId: string,
  //   ctx: Context,
  // ): Promise<void> {
  // }
}
