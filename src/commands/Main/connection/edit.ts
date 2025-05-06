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
import type Context from '#src/core/CommandContext/Context.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { isGuildTextBasedChannel } from '#utils/ChannelUtls.js';
import { updateConnection } from '#utils/ConnectedListUtils.js';
import { createServerInvite } from '#src/utils/Utils.js';
import Constants from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { t } from '#utils/Locale.js';
import { fetchUserLocale, getOrCreateWebhook } from '#utils/Utils.js';
import { buildConnectionEditUI } from '#utils/network/buildConnectionAssetsV2.js';
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
  }

  @RegisterInteractionHandler('connection')
  async handleStringSelects(ctx: ComponentContext) {
    if (!ctx.isStringSelectMenu()) return;

    const channelId = ctx.customId.args.at(0);
    const userIdFilter = ctx.customId.args.at(1);
    const locale = await fetchUserLocale(ctx.user.id);

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

    // Get the selected values from the select menu
    const values = ctx.values;
    if (!values || values.length === 0) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Invalid selection. Please try again.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    switch (values[0]) {
      case 'compact':
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

      case 'invite': {
        // Check if we're in a guild
        if (!ctx.guild) {
          await ctx.reply({
            content: `${getEmoji('x_icon', ctx.client)} This command can only be used in a server.`,
            flags: ['Ephemeral'],
          });
          return;
        }

        await ctx.deferUpdate();

        // Create a server invite directly
        const { success, inviteUrl: invite } = await createServerInvite(
          channelId,
          ctx.guild,
          ctx.user.username,
        );

        if (success && invite) {
          await updateConnection({ channelId }, { invite });
        }

        // Send response
        const messageKey = success ? 'connection.inviteAdded' : 'connection.setInviteError';
        const emojiKey = success ? 'tick_icon' : 'x_icon';

        await ctx.reply({
          content: t(messageKey, locale, {
            emoji: getEmoji(emojiKey, ctx.client),
          }),
          flags: ['Ephemeral'],
        });

        // Build the connection edit UI using Components v2
        const inviteContainer = await buildConnectionEditUI(
          ctx.client,
          channelId,
          ctx.user.id,
          locale,
        );

        // Note: For editReply, flags are part of the options object
        await ctx.editReply({
          components: [inviteContainer],
          flags: ['IsComponentsV2'],
        });
        break;
      }
      case 'embed_color': {
        const modal = new ModalBuilder()
          .setTitle('Set Embed Color')
          .setCustomId(
            new CustomID()
              .setIdentifier('connectionModal', 'embed_color')
              .setArgs(channelId)
              .toString(),
          )
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('embed_color')
                .setStyle(TextInputStyle.Short)
                .setLabel('Embed Color')
                .setPlaceholder('Provide a hex color code or leave blank to remove.')
                .setValue(connection.embedColor ?? '#000000')
                .setRequired(false),
            ),
          );

        await ctx.showModal(modal);
        break;
      }
      default:
        break;
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
}
