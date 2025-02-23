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

import HubCommand, { hubOption } from '#src/commands/Main/hub/index.js';
import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import HubManager from '#src/managers/HubManager.js';
import { HubSettingsString } from '#src/modules/BitFields.js';
import { HubService } from '#src/services/HubService.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { executeHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import {
  ActionRowBuilder,
  Client,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  type AutocompleteInteraction,
} from 'discord.js';

const CustomIdPrefix = 'hubConfig' as const;

export default class HubConfigSettingsSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'settings',
      description: '⚡⚙️ View and toggle settings of the hub.',
      types: { slash: true, prefix: true },
      options: [hubOption],
    });
  }

  async execute(ctx: Context) {
    const hubName = ctx.options.getString('hub');
    const hub = hubName ? (await this.hubService.findHubsByName(hubName)).at(0) : null;

    if (
      !hub ||
      !(await executeHubRoleChecksAndReply(hub, ctx, {
        checkIfManager: true,
      }))
    ) return;

    await ctx.reply({
      embeds: [hub.settings.getEmbed(ctx.client)],
      components: [HubConfigSettingsSubcommand.getSettingsMenu(hub, ctx.client)],
    });
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    return await HubCommand.handleManagerCmdAutocomplete(interaction, this.hubService);
  }

  @RegisterInteractionHandler(CustomIdPrefix, 'settings')
  async handleSettingsMenu(interaction: StringSelectMenuInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId] = customId.args;

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) return;

    const setting = interaction.values[0] as HubSettingsString;
    const value = await hub.settings.updateSetting(setting);

    await interaction.update({
      embeds: [hub.settings.getEmbed(interaction.client)],
      components: [HubConfigSettingsSubcommand.getSettingsMenu(hub, interaction.client)],
    });

    await interaction.followUp({
      content: `${getEmoji('info_icon', interaction.client)} Setting \`${setting}\` is now **${value ? 'Enabled' : 'Disabled'}**`,
      flags: ['Ephemeral'],
    });
  }

  static getSettingsMenu(hub: HubManager, client: Client) {
    const settings = Object.keys(hub.settings.getAll());
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(
          new CustomID().setIdentifier(CustomIdPrefix, 'settings').setArgs(hub.id).toString(),
        )
        .setPlaceholder('Select a setting to toggle')
        .setOptions(
          settings.map((setting) => ({
            label: `Toggle ${setting}`,
            value: setting,
            emoji: getEmoji(
              hub.settings.has(setting as HubSettingsString) ? 'enabled' : 'disabled',
              client,
            ),
          })),
        ),
    );
  }
}
