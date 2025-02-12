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
import Logger from '#src/utils/Logger.js';
import { isGuildTextBasedChannel } from '#utils/ChannelUtls.js';
import { updateConnection } from '#utils/ConnectedListUtils.js';
import Constants from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { t } from '#utils/Locale.js';
import { fetchUserLocale, getOrCreateWebhook } from '#utils/Utils.js';
import {
  buildChannelSelect,
  buildEditEmbed,
  buildEditSelect,
} from '#utils/network/buildConnectionAssets.js';
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  type ChannelSelectMenuInteraction,
  ModalBuilder,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import BaseCommand from '#src/core/BaseCommand.js';
import ConnectionCommand from '#src/commands/Main/connection/index.js';

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

    const channelId =
      ctx.options.getString('channel')?.replace(Constants.Regex.ChannelMention, '') ??
      ctx.channelId;

    const isInDb = await db.connection.findFirst({ where: { channelId } });
    const locale = await ctx.getLocale();

    if (!isInDb) {
      await ctx.replyEmbed('connection.notFound', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    const channelExists = await ctx.guild?.channels.fetch(channelId).catch(() => null);
    if (!channelExists) {
      await updateConnection({ channelId }, { connected: !isInDb.connected });

      await ctx.replyEmbed('connection.channelNotFound', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
    }

    const iconURL = ctx.guild?.iconURL() ?? ctx.user.avatarURL()?.toString();

    const embed = await buildEditEmbed(ctx.client, channelId, iconURL, locale);
    const editSelect = buildEditSelect(ctx.client, channelId, ctx.user.id, locale);
    const channelSelect = buildChannelSelect(channelId, ctx.user.id);

    await ctx.editOrReply({
      embeds: [embed],
      components: [channelSelect, editSelect],
    });
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    await ConnectionCommand.autocomplete(interaction);
  }

  @RegisterInteractionHandler('connectionModal')
  async handleModals(interaction: ModalSubmitInteraction): Promise<void> {
    const customId = CustomID.parseCustomId(interaction.customId);
    const locale = await fetchUserLocale(interaction.user.id);

    if (customId.suffix === 'invite') {
      await interaction.deferReply({ flags: ['Ephemeral'] });

      const invite = interaction.fields.getTextInputValue('connInviteField');
      const [channelId] = customId.args;

      if (!invite) {
        await updateConnection({ channelId }, { invite: { unset: true } });
        await interaction.followUp({
          content: t('connection.inviteRemoved', locale, {
            emoji: getEmoji('tick_icon', interaction.client),
          }),
          flags: ['Ephemeral'],
        });
        return;
      }

      const validInvite = Constants.Regex.DiscordInvite.test(invite);
      const fetchedInvite = validInvite
        ? await interaction.client?.fetchInvite(invite).catch(() => null)
        : null;

      if (fetchedInvite?.guild?.id !== interaction.guildId) {
        await interaction.followUp({
          content: t('connection.inviteInvalid', locale, {
            emoji: getEmoji('x_icon', interaction.client),
          }),
          flags: ['Ephemeral'],
        });
        return;
      }

      await updateConnection({ channelId }, { invite });

      await interaction.followUp({
        content: t('connection.inviteAdded', locale, {
          emoji: getEmoji('tick_icon', interaction.client),
        }),
        flags: ['Ephemeral'],
      });
    }
    else if (customId.suffix === 'embed_color') {
      const embedColor = interaction.fields.getTextInputValue('embed_color');

      if (!Constants.Regex.Hexcode.test(embedColor)) {
        await interaction.reply({
          content: t('connection.emColorInvalid', locale, {
            emoji: getEmoji('x_icon', interaction.client),
          }),
          flags: ['Ephemeral'],
        });
        return;
      }

      await updateConnection(
        { channelId: customId.args[0] },
        { embedColor: embedColor ?? { unset: true } },
      );

      await interaction.reply({
        content: t('connection.emColorChange', locale, {
          action: embedColor ? `set to \`${embedColor}\`!` : 'unset',
          emoji: getEmoji('tick_icon', interaction.client),
        }),
        flags: ['Ephemeral'],
      });
    }

    await interaction.message
      ?.edit({
        embeds: [
          await buildEditEmbed(
            interaction.client,
            customId.args[0],
            interaction.guild?.iconURL() ?? interaction.user.avatarURL()?.toString(),
            locale,
          ),
        ],
      })
      .catch(() => null);
  }

  @RegisterInteractionHandler('connection')
  async handleStringSelects(interaction: StringSelectMenuInteraction) {
    if (!interaction.isStringSelectMenu()) return;

    const customId = CustomID.parseCustomId(interaction.customId);
    const channelId = customId.args.at(0);
    const userIdFilter = customId.args.at(1);

    const locale = await fetchUserLocale(interaction.user.id);

    if (userIdFilter !== interaction.user.id) {
      const embed = new InfoEmbed().setDescription(
        t('errors.notYourAction', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
      );
      await interaction.reply({ embeds: [embed], flags: ['Ephemeral'] });
      return;
    }

    const connection = await db.connection.findFirst({ where: { channelId } });
    if (!channelId || !connection) {
      await interaction.reply({
        content: t('connection.channelNotFound', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    switch (interaction.values[0]) {
      case 'compact':
        await updateConnection({ channelId }, { compact: !connection.compact });
        break;

      case 'invite': {
        const modal = new ModalBuilder()
          .setTitle('Add Invite Link')
          .setCustomId(
            new CustomID().setIdentifier('connectionModal', 'invite').setArgs(channelId).toString(),
          )
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setLabel('Invite Link')
                .setValue('https://discord.gg/')
                .setCustomId('connInviteField')
                .setRequired(false)
                .setStyle(TextInputStyle.Short),
            ),
          );

        await interaction.showModal(modal);
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

        await interaction.showModal(modal);
        break;
      }

      default:
        break;
    }

    const newEmbeds = await buildEditEmbed(
      interaction.client,
      channelId,
      interaction.guild?.iconURL() ?? interaction.user.avatarURL()?.toString(),
      locale,
    );
    const msgBody = { embeds: [newEmbeds] };

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.message.edit(msgBody);
      }
      else {
        await interaction.update(msgBody);
      }
    }
    catch (e) {
      Logger.error('[/connection edit] Error updating message', e);
    }
  }

  @RegisterInteractionHandler('connection', 'change_channel')
  async handleChannelSelects(interaction: ChannelSelectMenuInteraction) {
    if (!interaction.isChannelSelectMenu()) return;
    await interaction.deferUpdate();

    const locale = await fetchUserLocale(interaction.user.id);

    const emoji = getEmoji('x_icon', interaction.client);
    const customId = CustomID.parseCustomId(interaction.customId);
    const channelId = customId.args.at(0);
    const userIdFilter = customId.args.at(1);

    const newChannel = interaction.channels.first();

    if (!isGuildTextBasedChannel(newChannel) || newChannel.isVoiceBased()) {
      await interaction.followUp({
        content: t('hub.invalidChannel', locale, { emoji }),
        flags: ['Ephemeral'],
      });
      return;
    }

    if (userIdFilter !== interaction.user.id) {
      const embed = new InfoEmbed().setDescription(t('errors.notYourAction', locale, { emoji }));

      await interaction.reply({ embeds: [embed], flags: ['Ephemeral'] });
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

      await interaction.followUp({ embeds: [embed], flags: ['Ephemeral'] });
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

    const editSelect = buildEditSelect(
      interaction.client,
      newChannel.id,
      interaction.user.id,
      locale,
    );
    const channelSelect = buildChannelSelect(newChannel.id, interaction.user.id);

    await interaction.editReply({
      embeds: [
        await buildEditEmbed(
          interaction.client,
          newChannel.id,
          interaction.guild?.iconURL() ?? interaction.user.avatarURL()?.toString(),
          locale,
        ),
      ],
      components: [channelSelect, editSelect],
    });
  }
}
