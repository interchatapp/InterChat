import { ChatInputCommandInteraction, ButtonBuilder, ActionRowBuilder, ButtonStyle, GuildTextBasedChannel, EmbedBuilder, ChannelType, ComponentType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, Interaction, ChannelSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, TextChannel, ButtonInteraction, AnySelectMenuInteraction, Webhook, ThreadChannel } from 'discord.js';
import { reconnect, disconnect } from '../../Structures/network';
import { colors, getDb } from '../../Utils/functions/utils';
import logger from '../../Utils/logger';
import { captureException } from '@sentry/node';

function yesOrNo(option: unknown, yesEmoji: string, noEmoji: string) {
  return option ? yesEmoji : noEmoji;
}

// function to make it easier to edit embeds with updated data
async function setupEmbed(interaction: Interaction, channelId: string) {
  const networkData = await getDb().connectedList.findFirst({ where: { channelId } });

  const { yes, no, enabled, disabled } = interaction.client.emotes.normal;
  const invite = networkData?.invite
    ? `Code: [\`${networkData.invite}\`](https://discord.gg/${networkData.invite})`
    : 'Not Set.';

  return new EmbedBuilder()
    .setTitle('Edit Settings')
    .setDescription(`Showing network settings for <#${channelId}>.`)
    .addFields([
      { name: 'Channel', value: `<#${channelId}>`, inline: true },
      { name: 'Invite', value: invite, inline: true },
      { name: 'Connected', value: yesOrNo(networkData?.connected, yes, no), inline: true },
      { name: 'Compact', value: yesOrNo(networkData?.compact, enabled, disabled), inline: true },
      { name: 'Profanity Filter', value: yesOrNo(networkData?.profFilter, enabled, disabled), inline: true },
    ])
    .setColor(colors('chatbot'))
    .setThumbnail(interaction.guild?.iconURL() || interaction.client.user.avatarURL())
    .setTimestamp()
    .setFooter({ text: 'Use to menu below to edit.' });
}

export = {
  async execute(interaction: ChatInputCommandInteraction | ButtonInteraction | AnySelectMenuInteraction, channelId: string) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply();

    const db = getDb();
    const emoji = interaction.client.emotes;
    const connection = await db.connectedList.findFirst({ where: { channelId } });
    if (!connection) return await interaction.editReply(`${emoji.normal.no} Invalid network connection provided.`);

    const setupActionButtons = new ActionRowBuilder<ButtonBuilder>().addComponents([
      new ButtonBuilder()
        .setCustomId(connection.connected ? 'disconnect' : 'reconnect')
        .setLabel(connection.connected ? 'Disconnect' : 'Reconnect')
        .setStyle(connection.connected ? ButtonStyle.Danger : ButtonStyle.Success)
        .setEmoji(connection.connected ? emoji.icons.disconnect : emoji.icons.connect),
    ]);

    const customizeMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents([
      new StringSelectMenuBuilder()
        .setCustomId('customize')
        .setPlaceholder('🛠️ Select a setting to toggle')
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('Compact')
            .setEmoji(emoji.normal.clipart)
            .setDescription('Disable embeds in the network to fit more messages. Works with webhooks.')
            .setValue('compact'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Profanity Filter')
            .setEmoji('🤬')
            .setDescription('Toggle swear word censoring for this server.')
            .setValue('profanity'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Invite Link')
            .setEmoji(emoji.icons.members)
            .setDescription('Set an invite for network users to join your server easily!')
            .setValue('invite'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Switch Channel')
            .setEmoji(emoji.icons.store)
            .setDescription('Set a different channel for the network.')
            .setValue('change_channel'),
        ),
    ]);

    const channelExists = await interaction.client.channels.fetch(connection.channelId).catch(() => null);
    const setupMessage = await interaction.editReply({
      embeds: [await setupEmbed(interaction, channelId)],
      components: [customizeMenu, setupActionButtons],
    });

    if (!channelExists) {
      await disconnect(connection.channelId);
      await interaction.followUp({
        content: `${emoji.normal.no} Automatically disconnected from network due to errors. Change the channel to use the network.`,
        ephemeral: true,
      });
    }

    const filter = (m: Interaction) => m.user.id === interaction.user.id;

    const buttonCollector = setupMessage.createMessageComponentCollector({
      filter,
      componentType: ComponentType.Button,
    });

    /* ------------------- Button Responce collectors ---------------------- */
    buttonCollector.on('collect', async (component) => {
      const updConnection = await db.connectedList.findFirst({ where: { channelId: connection.channelId } });
      if (!updConnection) {
        await component.reply({
          content: `${emoji.normal.no} This network no longer exists!`,
          ephemeral: true,
        });
        return;
      }

      switch (component.customId) {
        case 'reconnect': {
          const channel = await interaction.guild?.channels
            .fetch(String(updConnection.channelId))
            .catch(() => null) as GuildTextBasedChannel | null;

          if (!channel) {
            component.reply({
              content: `${emoji.normal.no} Unable to find network channel!`,
              ephemeral: true,
            });
            return;
          }

          await reconnect(channel.id);
          logger.info(`${interaction.guild?.name} (${interaction.guildId}) has joined the network.`);

          setupActionButtons.components.at(0)
            ?.setCustomId('disconnect')
            .setLabel('Disconnect')
            .setStyle(ButtonStyle.Danger)
            .setEmoji(emoji.icons.disconnect);

          await component.reply({ content: 'Channel has been reconnected!', ephemeral: true });
          interaction.editReply({
            components: [customizeMenu, setupActionButtons],
          });
          break;
        }

        case 'disconnect':
          await disconnect(updConnection.channelId);
          setupActionButtons.components.at(0)
            ?.setCustomId('reconnect')
            .setLabel('Reconnect')
            .setStyle(ButtonStyle.Success)
            .setEmoji(emoji.icons.connect);


          logger.info(`${interaction.guild?.name} (${interaction.guildId}) has disconnected from the network.`);

          await component.reply({ content: 'Disconnected!', ephemeral: true });
          interaction.editReply({
            components: [customizeMenu, setupActionButtons],
          });
          break;

        default:
          break;
      }
      component.replied || component.deferred
        ? interaction.editReply({ embeds: [await setupEmbed(interaction, updConnection.channelId)] })
        : component.update({ embeds: [await setupEmbed(interaction, updConnection.channelId)] });

    });


    /* ------------------- Replying to SelectMenus ---------------------- */
    const selectCollector = setupMessage.createMessageComponentCollector({
      filter,
      idle: 60_000 * 5,
      componentType: ComponentType.StringSelect,
    });

    selectCollector.on('collect', async (settingsMenu) => {
      const updConnection = await db.connectedList.findFirst({ where: { channelId: connection.channelId } });
      if (!updConnection) {
        await settingsMenu.reply({
          content: `${emoji.normal.no} This network no longer exists!`,
          ephemeral: true,
        });
        return;
      }

      switch (settingsMenu.values[0]) {
        /* Compact / Normal mode toggle  */
        case 'compact': {
          await db.connectedList.update({
            where: { channelId: updConnection.channelId },
            data: { compact: !updConnection.compact },
          });
          break;
        }
        /* Profanity toggle */
        case 'profanity': {
          await db.connectedList.update({
            where: { channelId: updConnection.channelId },
            data: { profFilter: !updConnection.profFilter },
          });
          break;
        }

        case 'change_channel': {
          const channelMenu = new ActionRowBuilder<ChannelSelectMenuBuilder>()
            .addComponents(
              new ChannelSelectMenuBuilder()
                .setCustomId('newChannelSelect')
                .setPlaceholder('Select new channel')
                .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread),
            );

          const changeMsg = await settingsMenu.reply({
            content: 'Please select a channel within the next 20 seconds.',
            components: [channelMenu],
            ephemeral: true,
            fetchReply: true,
          });

          const selected = await changeMsg.awaitMessageComponent({
            componentType: ComponentType.ChannelSelect,
            time: 20_000,
          }).catch(() => null);

          if (!selected) return;

          const newchannel = selected.guild?.channels.cache.get(selected?.values[0]) as TextChannel | ThreadChannel;
          const newchannelInDb = await db.connectedList.findFirst({ where: { channelId: newchannel.id } });

          // if the hubId doesn't match with the already connected channel
          // don't let to switch channel as it is already connected to another hub
          if (newchannelInDb && newchannelInDb.channelId !== updConnection.channelId) {
            await selected.update({
              content: `${emoji.normal.no} Channel ${newchannel} has already joined a hub. Either leave that hub first or select another channel.`,
              components: [],
            });
            return;
          }

          let webhook: Webhook | null = null;
          if (newchannel.type === ChannelType.GuildText) {
            const webhooks = await newchannel.fetchWebhooks();
            const interchatHook = webhooks?.find((hook) => hook.owner?.id === hook.client.user?.id);

            // create a webhook in the new channel
            webhook = interchatHook ||
            await newchannel.createWebhook({
              name: 'InterChat Network',
              avatar: newchannel.client.user.avatarURL(),
            });
          }

          else if (newchannel.isThread() && newchannel.parent) {
            const webhooks = await newchannel.parent.fetchWebhooks();
            const interchatHook = webhooks?.find((hook) => hook.owner?.id === hook.client.user?.id);

            webhook = interchatHook ||
            await newchannel.parent.createWebhook({
              name: 'InterChat Network',
              avatar: newchannel.client.user.avatarURL(),
            });
          }

          await db.connectedList.update({
            where: { channelId: connection.channelId },
            data: {
              channelId: newchannel.id,
              parentId: newchannel?.isThread() ? newchannel.parentId : { unset: true },
              webhookURL: webhook?.url,
            },
          });

          await selected.update({
            content: `${emoji.normal.yes} Channel has been changed to ${newchannel}!`,
            components: [],
          });
          break;
        }

        /* Invite Selection Response */
        case 'invite': {
          await interaction.followUp({
            content: 'Setting an invite allows users to join your server through the `Server Info` context menu. Servers that go against our </rules:924659340898619395> will be removed.',
            ephemeral: true,
          });

          const modal = new ModalBuilder()
            .setCustomId(settingsMenu.id)
            .setTitle('Set Invite')
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId('invite_link')
                  .setStyle(TextInputStyle.Short)
                  .setLabel('Invite Link')
                  .setPlaceholder('Provide a invite link or code. Leave blank to remove.')
                  .setValue('https://discord.gg/')
                  .setMaxLength(35)
                  .setRequired(false),
              ),
            );

          await settingsMenu.showModal(modal);

          const modalResp = await settingsMenu.awaitModalSubmit({ time: 60_000 }).catch((e) => {
            if (!e.message.includes('reason: time')) {
              logger.error(e);
              captureException(e);
            }
            return null;
          });

          if (!modalResp) return;

          const link = modalResp.fields.getTextInputValue('invite_link');

          if (!link) {
            await db.connectedList.update({
              where: { channelId },
              data: { invite: { unset: true } },
            });
            modalResp.reply({ content: 'Invite unset.', ephemeral: true });
            return;
          }

          const isValid = await modalResp.client?.fetchInvite(link).catch(() => null);

          if (!isValid || isValid.guild?.id !== modalResp.guild?.id) {
            modalResp.reply({
              content: 'Invalid Invite.',
              ephemeral: true,
            });
            return;
          }

          await db.connectedList.update({ where: { channelId: updConnection.channelId }, data: { invite: isValid.code } });

          modalResp.reply({
            content: 'Invite link successfully set!',
            ephemeral: true,
          });
          break;
        }
      }

      settingsMenu.replied || settingsMenu.deferred
        ? interaction.editReply({ embeds: [await setupEmbed(interaction, updConnection.channelId)] })
        : settingsMenu.update({ embeds: [await setupEmbed(interaction, updConnection.channelId)] });
    });

    selectCollector.on('end', () => {
      const disabledBtns: ActionRowBuilder<ButtonBuilder> = new ActionRowBuilder(setupActionButtons);
      const disabledMenu: ActionRowBuilder<StringSelectMenuBuilder> = new ActionRowBuilder(customizeMenu);
      disabledMenu.components.forEach((menu) => menu.setDisabled(true));
      disabledBtns.components.forEach((button) => button.setDisabled(true));
      buttonCollector.stop('Components disabled.');

      interaction.editReply({ components: [disabledMenu, disabledBtns] }).catch(() => null);
      return;
    });
  },
};

// TODO: Hub leave command shows channel and now thread names in autocomplete
// TODO: channelId is no longer unique, either make it unique or fix the whole code
