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
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import type HubLogManager from '#src/managers/HubLogManager.js';
import type { Hub } from '#src/generated/prisma/client/client.js';
import { stripIndents } from 'common-tags';
import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  type Client,
  EmbedBuilder,
  type MessageComponentInteraction,
  ModalBuilder,
  type ModalSubmitInteraction,
  type RepliableInteraction,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import BaseCommand from '#src/core/BaseCommand.js';
// eslint-disable-next-line no-duplicate-imports
import type { LogConfigTypes as HubConfigTypes } from '#src/managers/HubLogManager.js';
import type HubManager from '#src/managers/HubManager.js';
import { HubService } from '#src/services/HubService.js';
import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { fetchUserLocale, getReplyMethod } from '#src/utils/Utils.js';
import Constants from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import { sendToHub } from '#utils/hub/utils.js';
import HubCommand, { hubOption } from '#src/commands/Main/hub/index.js';

const HUB_EDIT_IDENTIFIER = 'hubEdit';
const HUB_EDIT_MODAL_IDENTIFIER = 'hubEditModal';
const ACTIONS_ARG = 'actions';
const LOGS_CHANNEL_SELECT_ARG = 'logsChSel';

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

    const embed = await this.getRefreshedHubEmbed(hub, locale, ctx.client);
    const actionRow = this.buildActionsSelectMenu(ctx.user.id, hub.id, locale);

    await ctx.reply({ embeds: [embed], components: [actionRow] });
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    return await HubCommand.handleManagerCmdAutocomplete(interaction, this.hubService);
  }

  private buildActionsSelectMenu(userId: string, hubId: string, locale: supportedLocaleCodes) {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier(HUB_EDIT_IDENTIFIER, ACTIONS_ARG)
            .setArgs(userId)
            .setArgs(hubId)
            .toString(),
        )
        .addOptions([
          {
            label: t('hub.manage.description.selects.label', locale),
            value: HubEditAction.Description,
            description: t('hub.manage.description.selects.description', locale),
            emoji: '📝',
          },
          {
            label: t('hub.manage.icon.selects.label', locale),
            value: HubEditAction.Icon,
            description: t('hub.manage.icon.selects.description', locale),
            emoji: '🖼️',
          },
          {
            label: t('hub.manage.toggleLock.selects.label', locale),
            value: HubEditAction.ToggleLock,
            description: t('hub.manage.toggleLock.selects.description', locale),
            emoji: '🔒',
          },
          {
            label: t('hub.manage.banner.selects.label', locale),
            value: HubEditAction.Banner,
            description: t('hub.manage.banner.selects.description', locale),
            emoji: '🎨',
          },
        ]),
    );
  }

  @RegisterInteractionHandler(HUB_EDIT_IDENTIFIER, ACTIONS_ARG)
  async handleActionsSelect(interaction: MessageComponentInteraction) {
    if (!interaction.isStringSelectMenu()) return;

    const { hub, locale } = await this.ensureComponentValidity(interaction);
    if (!hub) return;

    const action = interaction.values[0] as HubEditAction;
    await this.handleActionSelection(interaction, hub, action, locale);
  }

  @RegisterInteractionHandler(HUB_EDIT_IDENTIFIER, LOGS_CHANNEL_SELECT_ARG)
  async handleLogChannelSelect(interaction: MessageComponentInteraction) {
    if (!interaction.isChannelSelectMenu()) return;

    const { hub, customId, locale } = await this.ensureComponentValidity(interaction);
    if (!hub) return;

    const logType = customId.args[2] as HubConfigTypes;
    const selectedChannel = interaction.channels.first();
    if (!selectedChannel) return;

    await this.updateHubLogChannel(
      interaction,
      await hub.fetchLogConfig(),
      logType,
      selectedChannel.id,
      locale,
    );
  }

  @RegisterInteractionHandler(HUB_EDIT_MODAL_IDENTIFIER)
  async handleModalSubmission(interaction: ModalSubmitInteraction) {
    const { hub, customId, locale } = await this.ensureModalValidity(interaction);
    if (!hub) return;

    switch (customId.suffix) {
      case HubEditModalSuffix.Description:
        await this.updateHubDescription(interaction, hub.id, locale);
        break;
      case HubEditModalSuffix.Icon:
        await this.updateHubIcon(interaction, hub.id, locale);
        break;
      case HubEditModalSuffix.Banner:
        await this.updateHubBanner(interaction, hub.id, locale);
        break;
      default:
        break;
    }

    await this.updateOriginalMessage(interaction, hub.id, locale);
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
    interaction: MessageComponentInteraction,
    hub: HubManager,
    action: HubEditAction,
    locale: supportedLocaleCodes,
  ) {
    switch (action) {
      case HubEditAction.Icon:
      case HubEditAction.Description:
      case HubEditAction.Banner:
        await this.showEditModal(interaction, hub.id, action, locale);
        break;
      case HubEditAction.ToggleLock:
        await this.toggleHubLock(interaction, hub, locale);
        break;
      default:
        break;
    }
  }

  private async showEditModal(
    interaction: MessageComponentInteraction,
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
    await interaction.showModal(modal);
  }

  private async toggleHubLock(
    interaction: MessageComponentInteraction,
    hub: HubManager,
    locale: supportedLocaleCodes,
  ) {
    await interaction.deferReply({ flags: ['Ephemeral'] });

    const newLockState = !hub.data.locked;
    await hub.update({ locked: newLockState });
    const lockedStatus = newLockState ? 'locked' : 'unlocked';

    await this.replySuccess(
      interaction,
      `${lockedStatus === 'locked' ? '🔒' : '🔓'} ${t('hub.manage.toggleLock.confirmation', locale, { status: `**${lockedStatus}**` })}`,
    );

    const embed = await this.getRefreshedHubEmbed(hub, locale, interaction.client);
    await interaction.message.edit({ embeds: [embed] }).catch(() => null);

    await sendToHub(hub.id, {
      username: hub.data.name ?? 'InterChat Hub Announcement',
      avatarURL: hub.data.iconUrl,
      embeds: [
        new InfoEmbed()
          .setTitle(
            `🛡️ ${t('hub.manage.toggleLock.announcementTitle', locale, { status: lockedStatus })}`,
          )
          .setDescription(
            t(`hub.manage.toggleLock.announcementDescription.${lockedStatus}`, locale),
          ),
      ],
    });
  }

  private async updateHubLogChannel(
    interaction: MessageComponentInteraction,
    logManager: HubLogManager,
    logType: HubConfigTypes,
    channelId: string,
    locale: supportedLocaleCodes,
  ) {
    await logManager.setLogChannel(logType, channelId);

    const embed = interaction.message.embeds[0]?.toJSON();
    if (embed?.fields?.at(0)) {
      embed.fields[0].value = this.channelMention(channelId, interaction.client);
      await interaction.update({ embeds: [embed] });
    }

    await interaction.followUp({
      embeds: [
        new InfoEmbed().setDescription(
          t('hub.manage.logs.channelSuccess', locale, {
            emoji: getEmoji('tick_icon', interaction.client),
            type: logType,
            channel: this.channelMention(channelId, interaction.client),
          }),
        ),
      ],
      flags: 'Ephemeral',
    });
  }

  private async updateHubDescription(
    interaction: ModalSubmitInteraction,
    hubId: string,
    locale: supportedLocaleCodes,
  ) {
    const description = interaction.fields.getTextInputValue(HubEditAction.Description);
    const hub = await this.hubService.fetchHub(hubId);

    if (!hub) {
      await this.replyError(
        interaction,
        t('hub.notFound_mod', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
        true,
      );
      return;
    }

    await hub.update({ description });
    await this.replySuccess(interaction, t('hub.manage.description.changed', locale), true);
  }

  private async updateHubIcon(
    interaction: ModalSubmitInteraction,
    hubId: string,
    locale: supportedLocaleCodes,
  ) {
    const iconUrl = interaction.fields.getTextInputValue(HubEditAction.Icon);

    if (!Constants.Regex.ImageURL.test(iconUrl)) {
      const embed = new InfoEmbed().setDescription(
        t('hub.invalidImgurUrl', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
      );

      await interaction.reply({ embeds: [embed] });
      return;
    }

    const hub = await this.getHubOrReplyError(interaction, hubId, locale);
    if (!hub) return;

    await hub.update({ iconUrl });
    await this.replySuccess(interaction, t('hub.manage.icon.changed', locale), true);
  }

  private async updateHubBanner(
    interaction: ModalSubmitInteraction,
    hubId: string,
    locale: supportedLocaleCodes,
  ) {
    await interaction.deferReply({ flags: ['Ephemeral'] });

    const hub = await this.getHubOrReplyError(interaction, hubId, locale);
    if (!hub) return;

    const bannerUrl = interaction.fields.getTextInputValue(HubEditAction.Banner);

    if (!bannerUrl) {
      await hub.update({ bannerUrl: null });
      await interaction.editReply(t('hub.manage.banner.removed', locale));
      return;
    }

    if (!Constants.Regex.ImageURL.test(bannerUrl)) {
      await interaction.editReply(
        t('hub.invalidImgurUrl', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
      );
      return;
    }

    await hub.update({ bannerUrl });

    await interaction.editReply(
      `${getEmoji('tick_icon', interaction.client)} ${t('hub.manage.banner.changed', locale)}`,
    );
  }

  private async updateOriginalMessage(
    interaction: ModalSubmitInteraction,
    hubId: string,
    locale: supportedLocaleCodes,
  ) {
    const updatedHub = await this.hubService.fetchHub(hubId);
    if (updatedHub) {
      const embed = await this.getRefreshedHubEmbed(updatedHub, locale, interaction.client);
      await interaction.message?.edit({ embeds: [embed] }).catch(() => null);
    }
  }

  private async ensureComponentValidity(interaction: MessageComponentInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const locale = await fetchUserLocale(interaction.user.id);

    if (customId.args[0] !== interaction.user.id) {
      await this.replyError(
        interaction,
        t('errors.notYourAction', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
        true,
      );
      return {};
    }

    const hub = await this.hubService.fetchHub(customId.args[1]);
    if (!hub) {
      await this.replyError(
        interaction,
        t('hub.notFound', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
        true,
      );
      return {};
    }

    return { hub, customId, locale };
  }

  private async ensureModalValidity(interaction: ModalSubmitInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId] = customId.args;
    const locale = await fetchUserLocale(interaction.user.id);

    const hub = await this.hubService.fetchHub(hubId);

    if (!(await hub?.isManager(interaction.user.id))) {
      await this.replyError(
        interaction,
        t('hub.notManager', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
        true,
      );
      return {};
    }

    return { hub, customId, locale };
  }

  private channelMention(channelId: string | undefined, client: Client) {
    return channelId ? `<#${channelId}>` : getEmoji('x_icon', client);
  }

  private async getHubOrReplyError(
    interaction: ModalSubmitInteraction,
    hubId: string,
    locale: supportedLocaleCodes,
  ) {
    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) {
      await this.replyError(
        interaction,
        t('hub.notFound_mod', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
        true,
      );
      return null;
    }
    return hub;
  }

  private async getRefreshedHubEmbed(
    hub: HubManager,
    locale: supportedLocaleCodes,
    client: Client,
  ) {
    const connections = await hub.connections.fetch();
    const mods = await hub.moderators.fetchAll();
    return await this.buildHubEmbed(hub.data, connections.length, mods.size, locale, client);
  }

  private async buildHubEmbed(
    hub: Hub,
    totalConnections: number,
    totalMods: number,
    locale: supportedLocaleCodes,
    client: Client,
  ) {
    const hubBlacklists = await db.infraction.findMany({
      where: { hubId: hub.id, status: 'ACTIVE' },
    });

    const dotBlueEmoji = getEmoji('dot', client);

    return new EmbedBuilder()
      .setTitle(hub.name)
      .setColor(Constants.Colors.interchat)
      .setDescription(
        stripIndents`
          ${hub.description}

          ${dotBlueEmoji} __**${t('hub.manage.embed.visibility', locale)}:**__ ${hub.private ? t('global.private', locale) : t('global.public', locale)}
          ${dotBlueEmoji} __**${t('hub.manage.embed.connections', locale)}**__: ${totalConnections}
          ${dotBlueEmoji} __**${t('hub.manage.embed.chatsLocked', locale)}:**__ ${hub.locked ? t('global.yes', locale) : t('global.no', locale)}
        `,
      )
      .setThumbnail(hub.iconUrl || null)
      .setImage(hub.bannerUrl || null)
      .addFields(
        {
          name: t('hub.manage.embed.blacklists', locale),
          value: stripIndents`
            ${t('hub.manage.embed.total', locale)}: ${hubBlacklists.length}
            ${t('hub.manage.embed.users', locale)}: ${hubBlacklists.filter((i) => Boolean(i.userId)).length}
            ${t('hub.manage.embed.servers', locale)}: ${hubBlacklists.filter((i) => Boolean(i.serverId)).length}
          `,
          inline: true,
        },
        {
          name: t('hub.manage.embed.hubStats', locale),
          value: stripIndents`
            ${t('hub.manage.embed.moderators', locale)}: ${totalMods}
            ${t('hub.manage.embed.owner', locale)}: <@${hub.ownerId}>
          `,
          inline: true,
        },
      );
  }

  private async replyError(
    interaction: RepliableInteraction | MessageComponentInteraction,
    content: string,
    ephemeral = false,
  ) {
    const method = getReplyMethod(interaction);
    const flags = ephemeral ? (['Ephemeral'] as const) : [];
    await interaction[method]({
      embeds: [
        new InfoEmbed().setDescription(`${getEmoji('x_icon', interaction.client)} ${content}`),
      ],
      flags,
    });
  }

  private async replySuccess(
    interaction: RepliableInteraction | MessageComponentInteraction,
    content: string,
    ephemeral = false,
  ) {
    const method = getReplyMethod(interaction);
    const flags = ephemeral ? (['Ephemeral'] as const) : [];
    await interaction[method]({
      embeds: [
        new InfoEmbed().setDescription(`${getEmoji('tick_icon', interaction.client)} ${content}`),
      ],
      flags,
    });
  }
}
