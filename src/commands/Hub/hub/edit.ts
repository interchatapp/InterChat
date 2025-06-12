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

import type ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import type Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  type Client,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
} from 'discord.js';

import HubCommand, { hubOption } from '#src/commands/Hub/hub/index.js';
import BaseCommand from '#src/core/BaseCommand.js';
import type HubManager from '#src/managers/HubManager.js';
import { HubService } from '#src/services/HubService.js';
import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import Constants from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import { sendToHub } from '#utils/hub/utils.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';

const HUB_EDIT_IDENTIFIER = 'hubEdit';
const HUB_EDIT_MODAL_IDENTIFIER = 'hubEditModal';
const ACTIONS_ARG = 'actions';

const enum HubEditAction {
  Description = 'description',
  Icon = 'icon',
  ToggleLock = 'toggleLock',
  Banner = 'banner',
}

const enum HubEditModalSuffix {
  Description = 'description',
  Icon = 'icon',
  Banner = 'banner',
}

export default class HubEditSubcommand extends BaseCommand {
  constructor() {
    super({
      name: 'edit',
      description: '📝 Edit a hub you own.',
      types: { slash: true, prefix: true },
      options: [hubOption],
    });
  }
  private readonly hubService = new HubService();

  async execute(ctx: Context) {
    const { hub, locale } = await this.getHubAndLocale(ctx);
    if (!hub) return;

    // Create hub management container
    const container = await this.createHubManagementContainer(hub, ctx.client, locale, ctx.user.id);

    // Send the response with Components v2
    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    return await HubCommand.handleManagerCmdAutocomplete(interaction, this.hubService);
  }

  /**
   * Creates hub action select menu options
   * @param hub The hub to create options for
   * @returns Array of select menu options
   */
  private createHubActionOptions(hub: HubManager): Array<{
    label: string;
    value: string;
    emoji: string;
    description: string;
  }> {
    return [
      {
        label: 'Edit Description',
        value: HubEditAction.Description,
        emoji: '📝',
        description: 'Change the description of your hub',
      },
      {
        label: 'Change Icon',
        value: HubEditAction.Icon,
        emoji: '🖼️',
        description: 'Update the icon image for your hub',
      },
      {
        label: 'Update Banner',
        value: HubEditAction.Banner,
        emoji: '🎨',
        description: 'Change or remove the banner image',
      },
      {
        label: hub.data.locked ? 'Unlock Hub' : 'Lock Hub',
        value: HubEditAction.ToggleLock,
        emoji: hub.data.locked ? '🔓' : '🔒',
        description: hub.data.locked
          ? 'Allow members to send messages in this hub'
          : 'Prevent members from sending messages in this hub',
      },
    ];
  }

  @RegisterInteractionHandler(HUB_EDIT_IDENTIFIER, ACTIONS_ARG)
  async handleActionsSelect(ctx: ComponentContext) {
    if (!ctx.isStringSelectMenu()) return;

    const { hub, locale } = await this.ensureComponentValidity(ctx);
    if (!hub) return;

    const action = ctx.values?.[0] as HubEditAction;
    await this.handleActionSelection(ctx, hub, action, locale);
  }
  @RegisterInteractionHandler(HUB_EDIT_MODAL_IDENTIFIER)
  async handleModalSubmission(ctx: ComponentContext) {
    if (!ctx.isModalSubmit()) return;

    // Defer the update to prevent "unknown ctx" errors
    await ctx.deferUpdate();

    const { hub, locale } = await this.ensureModalValidity(ctx);
    if (!hub) return;

    switch (ctx.customId.suffix) {
      case HubEditModalSuffix.Description:
        await this.updateHubDescription(ctx, hub.id, locale);
        break;
      case HubEditModalSuffix.Icon:
        await this.updateHubIcon(ctx, hub.id, locale);
        break;
      case HubEditModalSuffix.Banner:
        await this.updateHubBanner(ctx, hub.id, locale);
        break;
      default:
        break;
    }

    await this.updateOriginalMessage(ctx, hub.id, locale);
  }

  // --- Helper Methods ---

  private async getHubAndLocale(ctx: Context) {
    const locale = await fetchUserLocale(ctx.user.id);
    const hubName = ctx.options.getString('hub', true);
    const [hub] = await this.hubService.findHubsByName(hubName);

    if (!hub) {
      await ctx.replyEmbed('hub.notFound_mod', {
        t: { emoji: ctx.getEmoji('x_icon') },
      });
      return { hub: null, locale };
    }

    if (!(await hub.isManager(ctx.user.id))) {
      await ctx.replyEmbed('hub.notManager', {
        t: { emoji: ctx.getEmoji('x_icon') },
      });
      return { hub: null, locale };
    }

    return { hub, locale };
  }

  private async handleActionSelection(
    ctx: ComponentContext,
    hub: HubManager,
    action: HubEditAction,
    locale: supportedLocaleCodes,
  ) {
    switch (action) {
      case HubEditAction.Icon:
      case HubEditAction.Description:
      case HubEditAction.Banner:
        await this.showEditModal(ctx, hub.id, action, locale);
        break;
      case HubEditAction.ToggleLock:
        await this.toggleHubLock(ctx, hub, locale);
        break;
      default:
        break;
    }
  }

  private async showEditModal(
    ctx: ComponentContext,
    hubId: string,
    actionType: Exclude<HubEditAction, HubEditAction.ToggleLock>,
    locale: supportedLocaleCodes,
  ) {
    const modal = new ModalBuilder()
      .setCustomId(new CustomID(`${HUB_EDIT_MODAL_IDENTIFIER}:${actionType}`, [hubId]).toString())
      .setTitle(t(`hub.manage.${actionType}.modal.title`, locale));

    const inputField = new TextInputBuilder()
      .setLabel(t(`hub.manage.${actionType}.modal.label`, locale))
      .setStyle(
        actionType === HubEditAction.Description ? TextInputStyle.Paragraph : TextInputStyle.Short,
      )
      .setCustomId(actionType);

    if (actionType === HubEditAction.Description) {
      inputField.setMaxLength(1024);
    }
    else {
      inputField.setPlaceholder(t('hub.manage.enterImgurUrl', locale));
    }

    if (actionType === HubEditAction.Banner) {
      inputField.setRequired(false);
    }

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(inputField));
    await ctx.showModal(modal);
  }

  private async toggleHubLock(
    ctx: ComponentContext,
    hub: HubManager,
    locale: supportedLocaleCodes,
  ) {
    await ctx.deferReply({ flags: ['Ephemeral'] });

    const newLockState = !hub.data.locked;
    await hub.update({ locked: newLockState });
    const lockedStatus = newLockState ? 'locked' : 'unlocked';

    // Create UI components helper
    const ui = new UIComponents(ctx.client);

    // Create success container
    const successContainer = ui.createSuccessMessage(
      lockedStatus === 'locked' ? '🔒 Hub Locked' : '🔓 Hub Unlocked',
      t('hub.manage.toggleLock.confirmation', locale, { status: `**${lockedStatus}**` }),
    );

    await ctx.editReply({
      components: [successContainer],
      flags: [MessageFlags.IsComponentsV2],
    });

    // Update the original message with Components v2
    const updatedHub = await this.hubService.fetchHub(hub.id);
    if (updatedHub) {
      // Create hub management container
      const container = await this.createHubManagementContainer(
        updatedHub,
        ctx.client,
        locale,
        ctx.user.id,
      );

      // Update the message with Components v2
      await ctx.interaction.message
        ?.edit({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        })
        .catch(() => null);
    }

    // Create announcement container for the hub
    const announcementContainer = new ContainerBuilder();

    // Add announcement header
    announcementContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## 🛡️ ${t('hub.manage.toggleLock.announcementTitle', locale, { status: lockedStatus })}\n${t(`hub.manage.toggleLock.announcementDescription.${lockedStatus}`, locale)}`,
      ),
    );

    await sendToHub(hub.id, {
      username: hub.data.name ?? 'InterChat Hub Announcement',
      avatarURL: hub.data.iconUrl,
      components: [announcementContainer],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  private async updateHubDescription(
    ctx: ComponentContext,
    hubId: string,
    locale: supportedLocaleCodes,
  ) {
    const description = ctx.getModalFieldValue(HubEditAction.Description);
    const hub = await this.hubService.fetchHub(hubId);

    if (!hub || !description) {
      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const errorContainer = ui.createErrorMessage(
        'Hub Not Found',
        t('hub.notFound_mod', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
      );

      await ctx.reply({
        components: [errorContainer],
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      });
      return;
    }

    // Update the hub description
    await hub.update({ description });

    // Create UI components helper
    const ui = new UIComponents(ctx.client);

    // Create success container
    const successContainer = ui.createSuccessMessage(
      'Description Updated',
      t('hub.manage.description.changed', locale),
    );

    await ctx.reply({
      components: [successContainer],
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
    });
  }

  private async updateHubIcon(
    ctx: ComponentContext,
    hubId: string,
    locale: supportedLocaleCodes,
  ) {
    const iconUrl = ctx.getModalFieldValue(HubEditAction.Icon);

    if (!iconUrl || !Constants.Regex.ImageURL.test(iconUrl)) {
      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const errorContainer = ui.createErrorMessage(
        'Invalid Image URL',
        t('hub.invalidImgurUrl', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
      );

      // Add dashboard tip
      errorContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(this.getDashboardTip(locale, hubId)),
      );

      await ctx.reply({
        components: [errorContainer],
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    const hub = await this.getHubOrReplyError(ctx, hubId, locale);
    if (!hub) return;

    // Update the hub icon
    await hub.update({ iconUrl });

    // Create UI components helper
    const ui = new UIComponents(ctx.client);

    // Create success container
    const successContainer = ui.createSuccessMessage(
      'Icon Updated',
      t('hub.manage.icon.changed', locale),
    );

    await ctx.reply({
      components: [successContainer],
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
    });
  }

  private getDashboardTip(locale: supportedLocaleCodes, hubId: string) {
    return t('hub.manage.dashboardTip', locale, {
      url: `${Constants.Links.Website}/dashboard/hubs/${hubId}/edit`,
    });
  }

  private async updateHubBanner(
    ctx: ComponentContext,
    hubId: string,
    locale: supportedLocaleCodes,
  ) {
    const hub = await this.getHubOrReplyError(ctx, hubId, locale);
    if (!hub) return;

    const bannerUrl = ctx.getModalFieldValue(HubEditAction.Banner);

    // Create UI components helper
    const ui = new UIComponents(ctx.client);

    if (!bannerUrl) {
      await hub.update({ bannerUrl: null });

      // Create success container for banner removal
      const successContainer = ui.createSuccessMessage(
        'Banner Removed',
        t('hub.manage.banner.removed', locale),
      );

      await ctx.editReply({
        components: [successContainer],
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    if (!Constants.Regex.ImageURL.test(bannerUrl)) {
      // Create error container
      const errorContainer = ui.createErrorMessage(
        'Invalid Image URL',
        t('hub.invalidImgurUrl', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
      );

      await ctx.editReply({
        components: [errorContainer],
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    await hub.update({ bannerUrl });

    // Create success container
    const successContainer = ui.createSuccessMessage(
      'Banner Updated',
      t('hub.manage.banner.changed', locale),
    );

    await ctx.editReply({
      components: [successContainer],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  private async updateOriginalMessage(
    ctx: ComponentContext,
    hubId: string,
    locale: supportedLocaleCodes,
  ) {
    const updatedHub = await this.hubService.fetchHub(hubId);
    if (updatedHub) {
      // Create hub management container
      const container = await this.createHubManagementContainer(
        updatedHub,
        ctx.client,
        locale,
        ctx.user.id,
      );

      // Update the message with Components v2
      await ctx.interaction.message
        ?.edit({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        })
        .catch(() => null);
    }
  }

  private async ensureComponentValidity(ctx: ComponentContext) {
    const locale = await fetchUserLocale(ctx.user.id);

    if (ctx.customId.args[0] !== ctx.user.id) {
      await this.replyError(
        ctx,
        t('errors.notYourAction', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
        true,
      );
      return {};
    }

    const hub = await this.hubService.fetchHub(ctx.customId.args[1]);
    if (!hub) {
      await this.replyError(
        ctx,
        t('hub.notFound', locale, {
          emoji: getEmoji('x_icon', ctx.client),
          hubs_link: `${Constants.Links.Website}/hubs}`,
        }),
        true,
      );
      return {};
    }

    return { hub, locale };
  }

  private async ensureModalValidity(ctx: ComponentContext) {
    const [hubId] = ctx.customId.args;
    const locale = await fetchUserLocale(ctx.user.id);

    const hub = await this.hubService.fetchHub(hubId);

    if (!(await hub?.isManager(ctx.user.id))) {
      await this.replyError(
        ctx,
        t('hub.notManager', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
        true,
      );
      return {};
    }

    return { hub, locale };
  }

  /**
   * Creates a hub management container with consistent layout
   * @param hub The hub to create the container for
   * @param client The Discord client
   * @param locale The locale to use for translations
   * @param userId The ID of the user viewing the container
   * @returns A container builder with the hub management UI
   */
  private async createHubManagementContainer(
    hub: HubManager,
    client: Client,
    locale: supportedLocaleCodes,
    userId: string,
  ): Promise<ContainerBuilder> {
    // Create UI components helper
    const ui = new UIComponents(client);

    // Create container for Components v2
    const container = new ContainerBuilder();

    // Add banner as media gallery if it exists
    if (hub.data.bannerUrl) {
      const mediaGallery = new MediaGalleryBuilder();
      const mediaItem = new MediaGalleryItemBuilder()
        .setURL(hub.data.bannerUrl)
        .setDescription(`${hub.data.name} banner`);

      mediaGallery.addItems(mediaItem);
      container.addMediaGalleryComponents(mediaGallery);
    }


    // Get hub stats for display
    const stats = await this.getHubStats(hub);

    // Create a section with hub name and icon as thumbnail
    const headerSection = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        stripIndents`
          # ${getEmoji('house_icon', client)} ${hub.data.name}
          ${hub.data.description || ''}
          `,
      ),
    );

    // Add hub icon as thumbnail if it exists
    if (hub.data.iconUrl) {
      headerSection.setThumbnailAccessory(
        new ThumbnailBuilder().setURL(hub.data.iconUrl).setDescription(`${hub.data.name} icon`),
      );
    }

    // Add the section to the container
    container.addSectionComponents(headerSection);

    // Add separator
    ui.addSeparator(container, SeparatorSpacingSize.Small);

    // Add hub status information in a visually appealing format
    const statusEmoji = hub.data.locked ? '🔒' : '🔓';
    const visibilityEmoji = hub.data.private ? '🔐' : '🌐';

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        stripIndents`
        ## Hub Status
        ${statusEmoji} **Status:** ${hub.data.locked ? 'Locked' : 'Unlocked'} ${hub.data.locked ? '(members cannot send messages)' : '(members can send messages)'}
        ${visibilityEmoji} **Visibility:** ${hub.data.private ? 'Private' : 'Public'} ${hub.data.private ? '(invite only)' : '(open to all)'}
        👥 **Connections:** ${stats.connections} servers
        👮 **Moderators:** ${stats.moderators} users
        `,
      ),
    );

    // Add separator
    ui.addSeparator(container, SeparatorSpacingSize.Small);

    // Add blacklist information
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        stripIndents`
        ## Blacklists
        ⚠️ **Total Blacklists:** ${stats.blacklists.total}
        👤 **Users:** ${stats.blacklists.users}
        🖥️ **Servers:** ${stats.blacklists.servers}
        `,
      ),
    );

    // Add separator
    ui.addSeparator(container, SeparatorSpacingSize.Small);

    // Add hub actions header with more visual appeal
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        stripIndents`
        ## ⚙️ Hub Management
        Use the dropdown menu below to manage your hub settings:
        `,
      ),
    );

    // Add select menu directly to the container
    container.addActionRowComponents((row) => {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier(HUB_EDIT_IDENTIFIER, ACTIONS_ARG)
            .setArgs(userId)
            .setArgs(hub.id)
            .toString(),
        )
        .setPlaceholder('Select an action to manage your hub')
        .addOptions(this.createHubActionOptions(hub));

      return row.addComponents(selectMenu);
    });

    // Add dashboard tip with better formatting
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        stripIndents`
            > ## ${getEmoji('info_icon', client)} **Need more options?**
            > ${this.getDashboardTip(locale, hub.id)}
            `,
      ),
    );

    return container;
  }

  // Removed unused channelMention method

  private async getHubOrReplyError(
    ctx: ComponentContext,
    hubId: string,
    locale: supportedLocaleCodes,
  ) {
    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) {
      // Create UI components helper
      const ui = new UIComponents(ctx.client);

      // Create error container
      const errorContainer = ui.createErrorMessage(
        'Hub Not Found',
        t('hub.notFound_mod', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
      );

      await ctx.reply({
        components: [errorContainer],
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      });
      return null;
    }
    return hub;
  }

  private async getHubStats(hub: HubManager) {
    const connections = await hub.connections.fetch();
    const mods = await hub.moderators.fetchAll();
    const hubBlacklists = await db.infraction.findMany({
      where: { hubId: hub.id, status: 'ACTIVE' },
    });

    return {
      connections: connections.length,
      moderators: mods.size,
      blacklists: {
        total: hubBlacklists.length,
        users: hubBlacklists.filter((i) => Boolean(i.userId)).length,
        servers: hubBlacklists.filter((i) => Boolean(i.serverId)).length,
      },
      owner: hub.data.ownerId,
    };
  }

  private async replyError(ctx: ComponentContext, content: string, ephemeral = false) {
    // Create UI components helper
    const ui = new UIComponents(ctx.client);

    // Create error container
    const errorContainer = ui.createErrorMessage('Error', content);

    await ctx.reply({
      components: [errorContainer],
      flags: ephemeral
        ? [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]
        : [MessageFlags.IsComponentsV2],
    });
  }
}
