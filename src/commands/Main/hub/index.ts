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

import AnnounceCommand from '#src/commands/Main/hub/announce.js';
import BrowseCommand from '#src/commands/Main/hub/browse.js';
import HubConfigAntiSwearSubcommand from '#src/commands/Main/hub/config/anti-swear.js';
import HubConfigAppealCooldownSubcommand from '#src/commands/Main/hub/config/appealCooldown.js';
import HubConfigLoggingSubcommand from '#src/commands/Main/hub/config/logging.js';
import HubConfigSettingsSubcommand from '#src/commands/Main/hub/config/settings.js';
import HubCreateSubCommand from '#src/commands/Main/hub/create.js';
import HubDeleteSubcommand from '#src/commands/Main/hub/delete.js';
import HubEditSubcommand from '#src/commands/Main/hub/edit.js';
import HubInfractionsSubcommand from '#src/commands/Main/hub/infractions.js';
import HubInviteCreateSubcommand from '#src/commands/Main/hub/invite/create.js';
import HubInviteListSubcommand from '#src/commands/Main/hub/invite/list.js';
import HubInviteRevokeSubcommand from '#src/commands/Main/hub/invite/revoke.js';
import HubJoinSubcommand from '#src/commands/Main/hub/join.js';
import HubLeaveSubcommand from '#src/commands/Main/hub/leave.js';
import HubModeratorAddSubcommand from '#src/commands/Main/hub/moderator/add.js';
import HubModeratorEditSubcommand from '#src/commands/Main/hub/moderator/edit.js';
import HubModeratorListSubcommand from '#src/commands/Main/hub/moderator/list.js';
import HubModeratorRemoveSubcommand from '#src/commands/Main/hub/moderator/remove.js';
import HubServersSubcommand from '#src/commands/Main/hub/servers.js';
import HubVisibilitySubcommnd from '#src/commands/Main/hub/visibility.js';
import BaseCommand from '#src/core/BaseCommand.js';
import HubManager from '#src/managers/HubManager.js';
import type { HubService } from '#src/services/HubService.js';
import db from '#utils/Db.js';
import { escapeRegexChars } from '#utils/Utils.js';
import {
  type APIApplicationCommandBasicOption,
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  type Snowflake,
} from 'discord.js';

export const hubOption: APIApplicationCommandBasicOption = {
  type: ApplicationCommandOptionType.String,
  name: 'hub',
  description: 'Choose a hub.',
  required: true,
  autocomplete: true,
};

export default class HubCommand extends BaseCommand {
  constructor() {
    super({
      name: 'hub',
      description: 'Manage your hubs.',
      contexts: { guildOnly: true },
      types: { slash: true, prefix: true },
      subcommands: {
        config: {
          logging: new HubConfigLoggingSubcommand(),
          settings: new HubConfigSettingsSubcommand(),
          'anti-swear': new HubConfigAntiSwearSubcommand(),
          'set-appeal-cooldown': new HubConfigAppealCooldownSubcommand(),
        },
        invite: {
          create: new HubInviteCreateSubcommand(),
          revoke: new HubInviteRevokeSubcommand(),
          list: new HubInviteListSubcommand(),
        },
        moderator: {
          add: new HubModeratorAddSubcommand(),
          remove: new HubModeratorRemoveSubcommand(),
          edit: new HubModeratorEditSubcommand(),
          list: new HubModeratorListSubcommand(),
        },
        announce: new AnnounceCommand(),
        browse: new BrowseCommand(),
        create: new HubCreateSubCommand(),
        delete: new HubDeleteSubcommand(),
        edit: new HubEditSubcommand(),
        infractions: new HubInfractionsSubcommand(),
        join: new HubJoinSubcommand(),
        leave: new HubLeaveSubcommand(),
        servers: new HubServersSubcommand(),
        visibility: new HubVisibilitySubcommnd(),
      },
    });
  }

  static async handleManagerCmdAutocomplete(
    interaction: AutocompleteInteraction,
    hubService: HubService,
  ): Promise<void> {
    const focusedValue = escapeRegexChars(interaction.options.getFocused());
    const hubChoices: HubManager[] = await HubCommand.getManagedHubs(
      focusedValue,
      interaction.user.id,
      hubService,
    );

    await interaction.respond(
      hubChoices.map((hub) => ({
        name: hub.data.name,
        value: hub.data.name,
      })),
    );
  }

  static async getPublicHubs(focusedValue: string, hubService: HubService) {
    const hubs = await db.hub.findMany({
      where: {
        name: { mode: 'insensitive', contains: focusedValue },
        private: false,
      },
      take: 25,
    });

    return hubs.map((hub) => new HubManager(hub, { hubService }));
  }

  static matchHubName(hubName: string, focusedValue: string) {
    return hubName.toLowerCase().includes(focusedValue.toLowerCase());
  }

  static async getModeratedHubs(focusedValue: string, modId: Snowflake, hubService: HubService) {
    const hubs = (await hubService.fetchModeratedHubs(modId))
      .filter((hub) => HubCommand.matchHubName(hub.data.name, focusedValue))
      .slice(0, 25);
    return hubs;
  }

  static async getManagedHubs(focusedValue: string, modId: Snowflake, hubService: HubService) {
    const hubs = (await hubService.fetchModeratedHubs(modId))
      .filter((hub) => HubCommand.matchHubName(hub.data.name, focusedValue))
      .slice(0, 25);

    return hubs;
  }

  static async getOwnedHubs(focusedValue: string, ownerId: Snowflake, hubService: HubService) {
    const hubs = await hubService.getOwnedHubs(ownerId);
    return hubs.filter((hub) => HubCommand.matchHubName(hub.data.name, focusedValue));
  }
}
