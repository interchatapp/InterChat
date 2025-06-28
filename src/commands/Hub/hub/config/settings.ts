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

import HubCommand, { hubOption } from '#src/commands/Hub/hub/index.js';
import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import HubManager from '#src/managers/HubManager.js';
import { HubSettingsString } from '#src/utils/BitFields.js';
import { HubService } from '#src/services/HubService.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { runHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import Constants from '#utils/Constants.js';
import { stripIndents } from 'common-tags';
import {
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContainerBuilder,
  SectionBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
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
      !(await runHubRoleChecksAndReply(hub, ctx, {
        checkIfManager: true,
      }))
    ) return;

    const settingsContainer = HubConfigSettingsSubcommand.getSettingsMenu(hub, ctx.client);

    await ctx.reply({
      components: [settingsContainer],
      flags: ['IsComponentsV2'],
    });
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    return await HubCommand.handleManagerCmdAutocomplete(interaction, this.hubService);
  }

  @RegisterInteractionHandler(CustomIdPrefix, 'toggle')
  async handleToggleSetting(ctx: ComponentContext) {
    const [hubId, setting] = ctx.customId.args as [string, HubSettingsString];

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) return;

    const updatedSettingValue = await hub.settings.updateSetting(setting);

    await ctx.editReply({
      components: [HubConfigSettingsSubcommand.getSettingsMenu(hub, ctx.client)],
      flags: ['IsComponentsV2'],
    });

    await ctx.reply({
      content: `${getEmoji('info_icon', ctx.client)} Setting \`${setting}\` is now **${updatedSettingValue ? 'Enabled' : 'Disabled'}**`,
      flags: ['Ephemeral'],
    });
  }

  static getSettingsMenu(hub: HubManager, client: Client) {
    const settingsData = hub.settings.getAll();
    const container = new ContainerBuilder();

    // header text display
    const headerText = new TextDisplayBuilder().setContent(
      stripIndents`
      ## ⚙️ Hub Settings
      Manage your hub settings below.\n${getEmoji('wand_icon', client)} For a visual settings interface, visit **[the Dashboard](${Constants.Links.Website}/dashboard/hubs)**.`,
    );
    container.addTextDisplayComponents(headerText);

    // separator
    container.addSeparatorComponents((separator) =>
      separator.setSpacing(SeparatorSpacingSize.Large),
    );

    // Setting descriptions
    const settingDescriptions = {
      Reactions: 'Allow users to add reactions to messages in the hub',
      HideLinks: 'Hide or replace links in messages with a placeholder',
      SpamFilter: 'Automatically detect and prevent spam messages',
      BlockInvites: 'Block Discord invite links in messages',
      UseNicknames: 'Use server nicknames instead of usernames for messages',
      BlockNSFW: 'Block NSFW images using content detection',
    };

    // Create a section for each setting with a toggle button
    Object.entries(settingsData).forEach(([setting, isEnabled]) => {
      const section = new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### ${setting}\n${settingDescriptions[setting as HubSettingsString] || 'No description available.'}`,
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(
              new CustomID()
                .setIdentifier(CustomIdPrefix, 'toggle')
                .setArgs(hub.id, setting)
                .toString(),
            )
            .setStyle(isEnabled ? ButtonStyle.Secondary : ButtonStyle.Success)
            .setLabel(isEnabled ? 'Disable' : 'Enable')
            .setEmoji(getEmoji(isEnabled ? 'x_icon' : 'tick_icon', client)),
        );

      container.addSectionComponents(section);
    });

    return container;
  }
}
