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

import ConnectionCommand from '#src/commands/Main/connection/index.js';
import BaseCommand from '#src/core/BaseCommand.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import type Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { isGuildTextBasedChannel } from '#utils/ChannelUtls.js';
import { updateConnection } from '#utils/ConnectedListUtils.js';
import Constants from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { t } from '#utils/Locale.js';
import { fetchUserLocale, getOrCreateWebhook } from '#utils/Utils.js';
import { buildConnectionEditUI } from '#utils/network/buildConnectionAssets.js';
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export default class ConnectionEditSubcommand extends BaseCommand {
  constructor() {
    super({
      name: 'edit',
      description: '📝 Set embed colors, compact mode and more!',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'channel',
          description: 'Choose a connection to manage.',
          required: false,
          autocomplete: true,
        },
      ],
    });
  }
  async execute(ctx: Context): Promise<void> {
    await ctx.deferReply();

    // Get the channel ID from options or current channel
    const channelIdInput =
      ctx.options.getString('channel')?.replace(Constants.Regex.ChannelMention, '') ??
      ctx.channelId;

    // Ensure channelId is not null
    if (!channelIdInput) {
      await ctx.replyEmbed('connection.notFound', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    const channelId = channelIdInput;
    const isInDb = await db.connection.findFirst({
      where: { channelId },
    });

    const locale = await ctx.getLocale();

    if (!isInDb) {
      await ctx.replyEmbed('connection.notFound', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    // Check if channel exists
    if (ctx.guild) {
      const channelExists = await ctx.guild.channels.fetch(channelId).catch(() => null);
      if (!channelExists) {
        await updateConnection({ channelId }, { connected: !isInDb.connected });

        await ctx.replyEmbed('connection.channelNotFound', {
          t: { emoji: ctx.getEmoji('x_icon') },
          flags: ['Ephemeral'],
        });
      }
    }

    // Build the connection edit UI using Components v2
    const container = await buildConnectionEditUI(ctx.client, channelId, ctx.user.id, locale);
    await ctx.editOrReply({ components: [container] }, ['IsComponentsV2']);
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    await ConnectionCommand.autocomplete(interaction);
  }

  @RegisterInteractionHandler('connectionModal')
  async handleModals(ctx: ComponentContext) {
    const locale = await fetchUserLocale(ctx.user.id);

    if (ctx.customId.suffix === 'embed_color') {
      const embedColor = ctx.getModalFieldValue('embed_color');

      if (!embedColor || !Constants.Regex.Hexcode.test(embedColor)) {
        await ctx.reply({
          content: t('connection.emColorInvalid', locale, {
            emoji: getEmoji('x_icon', ctx.client),
          }),
          flags: ['Ephemeral'],
        });
        return;
      }

      await ctx.deferUpdate();

      await updateConnection(
        { channelId: ctx.customId.args[0] },
        { embedColor: embedColor ?? { unset: true } },
      );

      // Build the connection edit UI using Components v2
      const container = await buildConnectionEditUI(
        ctx.client,
        ctx.customId.args[0],
        ctx.user.id,
        locale,
      );

      await ctx
        .editReply({
          components: [container],
          flags: ['IsComponentsV2'],
        })
        .catch(() => null);

      await ctx.reply({
        content: t('connection.emColorChange', locale, {
          action: embedColor ? `set to \`${embedColor}\`!` : 'unset',
          emoji: getEmoji('tick_icon', ctx.client),
        }),
        flags: ['Ephemeral'],
      });
    }
    else if (ctx.customId.suffix === 'invite_url') {
      const inviteUrl = ctx.getModalFieldValue('invite_url');
      const channelId = ctx.customId.args[0];

      await ctx.deferUpdate();

      // Validate invite URL if provided
      if (inviteUrl && !inviteUrl.includes('discord.gg/') && !inviteUrl.includes('discord.com/invite/')) {
        await ctx.reply({
          content: t('config.setInvite.invalid', locale, {
            emoji: getEmoji('x_icon', ctx.client),
          }),
          flags: ['Ephemeral'],
        });
        return;
      }

      // Update connection with new invite URL
      await updateConnection(
        { channelId },
        { invite: inviteUrl || null },
      );

      // Build the connection edit UI using Components v2
      const container = await buildConnectionEditUI(
        ctx.client,
        channelId,
        ctx.user.id,
        locale,
      );

      await ctx
        .editReply({
          components: [container],
          flags: ['IsComponentsV2'],
        })
        .catch(() => null);

      // Send appropriate success message
      const messageKey = inviteUrl ? 'connection.inviteAdded' : 'connection.inviteRemoved';
      await ctx.reply({
        content: t(messageKey, locale, {
          emoji: getEmoji('tick_icon', ctx.client),
        }),
        flags: ['Ephemeral'],
      });
    }
  }

  @RegisterInteractionHandler('connection', 'change_channel')
  async handleChannelSelects(ctx: ComponentContext) {
    if (!ctx.isChannelSelectMenu()) return;
    await ctx.deferUpdate();

    const locale = await fetchUserLocale(ctx.user.id);

    const emoji = getEmoji('x_icon', ctx.client);
    const channelId = ctx.customId.args.at(0);
    const userIdFilter = ctx.customId.args.at(1);

    // Get the first selected channel
    const newChannel = ctx.channels?.first();

    if (!newChannel || !isGuildTextBasedChannel(newChannel) || newChannel.isVoiceBased()) {
      await ctx.reply({
        content: t('hub.invalidChannel', locale, { emoji }),
        flags: ['Ephemeral'],
      });
      return;
    }

    if (userIdFilter !== ctx.user.id) {
      const embed = new InfoEmbed().setDescription(t('errors.notYourAction', locale, { emoji }));

      await ctx.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return;
    }

    const alreadyConnected = await db.connection.findFirst({
      where: { channelId: newChannel.id },
    });

    if (alreadyConnected) {
      const embed = new InfoEmbed().setDescription(
        t('connection.alreadyConnected', locale, {
          channel: `${newChannel}`,
          emoji,
        }),
      );

      await ctx.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return;
    }

    const newWebhook = await getOrCreateWebhook(newChannel);
    await updateConnection(
      { channelId },
      {
        channelId: newChannel.id,
        webhookURL: newWebhook?.url,
        parentId: newChannel.isThread() ? newChannel.parentId : null,
      },
    );

    // Build the connection edit UI using Components v2
    const channelContainer = await buildConnectionEditUI(
      ctx.client,
      newChannel.id,
      ctx.user.id,
      locale,
    );

    await ctx.editReply({
      components: [channelContainer],
      flags: ['IsComponentsV2'],
    });
  }

  @RegisterInteractionHandler('connection')
  async handleButtons(ctx: ComponentContext) {
    if (!ctx.isButton()) return;

    const channelId = ctx.customId.args.at(0);
    const userIdFilter = ctx.customId.args.at(1);
    const locale = await fetchUserLocale(ctx.user.id);

    // Check user permission
    if (userIdFilter !== ctx.user.id) {
      const embed = new InfoEmbed().setDescription(
        t('errors.notYourAction', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
      );
      await ctx.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return;
    }

    const connection = await db.connection.findFirst({ where: { channelId } });
    if (!channelId || !connection) {
      await ctx.reply({
        content: t('connection.channelNotFound', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    switch (ctx.customId.suffix) {
      case 'toggle':
        await ctx.deferUpdate();
        await updateConnection({ channelId }, { connected: !connection.connected });

        // Build the connection edit UI using Components v2
        const toggleContainer = await buildConnectionEditUI(
          ctx.client,
          channelId,
          ctx.user.id,
          locale,
        );

        await ctx.editReply({
          components: [toggleContainer],
          flags: ['IsComponentsV2'],
        });
        break;

      case 'toggle_compact':
        await ctx.deferUpdate();
        await updateConnection({ channelId }, { compact: !connection.compact });

        // Build the connection edit UI using Components v2
        const compactContainer = await buildConnectionEditUI(
          ctx.client,
          channelId,
          ctx.user.id,
          locale,
        );

        await ctx.editReply({
          components: [compactContainer],
          flags: ['IsComponentsV2'],
        });
        break;

      case 'set_color':
        // Show modal for embed color input
        const colorModal = new ModalBuilder()
          .setCustomId(
            new CustomID()
              .setIdentifier('connectionModal', 'embed_color')
              .setArgs(channelId)
              .toString(),
          )
          .setTitle('Set Embed Color');

        const colorInput = new TextInputBuilder()
          .setCustomId('embed_color')
          .setLabel('Embed Color (Hex Code)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('#5865F2')
          .setValue(connection.embedColor || '#5865F2')
          .setRequired(false);

        const colorRow = new ActionRowBuilder<TextInputBuilder>().addComponents(colorInput);
        colorModal.addComponents(colorRow);

        await ctx.showModal(colorModal);
        break;

      case 'set_invite':
        // Show modal for invite URL input
        const inviteModal = new ModalBuilder()
          .setCustomId(
            new CustomID()
              .setIdentifier('connectionModal', 'invite_url')
              .setArgs(channelId)
              .toString(),
          )
          .setTitle('Set Server Invite');

        const inviteInput = new TextInputBuilder()
          .setCustomId('invite_url')
          .setLabel('Server Invite URL')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('https://discord.gg/yourserver')
          .setValue(connection.invite || '')
          .setRequired(false);

        const inviteRow = new ActionRowBuilder<TextInputBuilder>().addComponents(inviteInput);
        inviteModal.addComponents(inviteRow);

        await ctx.showModal(inviteModal);
        break;

      case 'change_hub':
        // would require a hub selection interface - for now, show info message
        await ctx.reply({
          content: `${getEmoji('info_icon', ctx.client)} Hub changing functionality is not yet implemented. Please use the dashboard or contact support.`,
          flags: ['Ephemeral'],
        });
        break;

      case 'change_channel_btn':
        await ctx.reply({
          content: `${getEmoji('info_icon', ctx.client)} Please use the channel select menu below to change the channel.`,
          flags: ['Ephemeral'],
        });
        break;

      default:
        await ctx.reply({
          content: `${getEmoji('x_icon', ctx.client)} Unknown button action. Please try again.`,
          flags: ['Ephemeral'],
        });
        break;
    }
  }
}
