import { connectedList, hubs } from '@prisma/client';
import { captureException } from '@sentry/node';
import { logger } from '@sentry/utils';
import { ActionRowBuilder, ChatInputCommandInteraction, ComponentType, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getDb } from '../../Utils/utils';
import { stripIndents } from 'common-tags';
import emojis from '../../Utils/JSON/emoji.json';

export default {
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const db = getDb();
    const chosenHub = interaction.options.getString('name', true);
    let hubInDb = await db.hubs.findFirst({
      where: {
        name: chosenHub,
        OR: [
          { ownerId: interaction.user.id },
          { moderators: { some: { userId: interaction.user.id, position: 'manager' } } },
        ],
      },
      include: { connections: true },
    });

    if (!hubInDb) {
      await interaction.followUp(emojis.normal.no + ' Hub not found.');
      return;
    }

    const actionsSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('hub_actions')
        .addOptions([
          {
            label: 'Edit Description',
            value: 'description',
            description: 'Edit the hub description.',
            emoji: '✏️',
          },
          {
            label: 'Toggle Visibility',
            value: 'visibility',
            description: 'Toggle the hub visibility between public and private.',
            emoji: '🔒',
          },
          {
            label: 'Set Icon',
            value: 'icon',
            description: 'Set the hub icon.',
            emoji: '🖼️',
          },
          {
            label: 'Set Banner',
            value: 'banner',
            description: 'Set the hub banner.',
            emoji: '🎨',
          },
        ]),
    );


    const hubEmbed = async (hub: hubs & { connections: connectedList[] }) => {
      const hubBlacklistedUsers = await db.blacklistedUsers.count({
        where: { hubs: { some: { hubId: hub.id } } },
      });
      const hubBlacklistedServers = await db.blacklistedServers.count({
        where: { hubs: { some: { hubId: hub.id } } },
      });
      return new EmbedBuilder()
        .setTitle(hub.name)
        .setColor('Random')
        .setDescription(stripIndents`
        ${hub.description}
        - __**Public:**__ ${hub.private ? emojis.normal.no : emojis.normal.yes}
      `)
        .setThumbnail(hub.iconUrl)
        .setImage(hub.bannerUrl)
        .addFields(
          {
            name: 'Blacklists',
            value: stripIndents`
          - Users: ${hubBlacklistedUsers}
          - Servers: ${hubBlacklistedServers}
          `,
            inline: true,
          },

          {
            name: 'Hub Stats',
            value: stripIndents`
          - Moderators: ${hub.moderators.length.toString()}
          - Connected: ${hub.connections.length}
          - Owner: <@${hub.ownerId}>
          `,
            inline: true,
          },
        );

    };

    const reply = await interaction.followUp({
      embeds: [await hubEmbed(hubInDb)],
      components: [actionsSelect],
    });

    const collector = reply.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      idle: 60_000 * 5,
      componentType: ComponentType.StringSelect,
    });

    collector.on('collect', async (i) => {
      if (i.customId !== 'hub_actions') return;

      hubInDb = await db.hubs.findFirst({
        where: { id: hubInDb?.id },
        include: { connections: true },
      });

      if (!hubInDb) {
        await i.reply({ content: 'This hub no longer exists!', ephemeral: true });
        return;
      }

      switch (i.values[0]) {
        case 'icon': {
          const modal = new ModalBuilder()
            .setCustomId(i.id)
            .setTitle('Change Hub Icon')
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setLabel('Enter Icon URL')
                  .setPlaceholder('Enter a valid imgur image URL.')
                  .setStyle(TextInputStyle.Short)
                  .setCustomId('icon'),
              ));

          await i.showModal(modal);

          const modalResponse = await i.awaitModalSubmit({
            filter: m => m.customId === modal.data.custom_id,
            time: 60_000 * 5,
          }).catch(e => {
            if (!e.message.includes('ending with reason: time')) {
              logger.error(e);
              captureException(e, {
                user: { id: i.user.id, username: i.user.username },
                extra: { context: 'This happened when user tried to change hub icon.' },
              });
            }
            return null;
          });

          if (!modalResponse) return;

          const newIcon = modalResponse.fields.getTextInputValue('icon');
          // check if icon is a valid imgur link
          const imgurLink = newIcon.match(/\bhttps?:\/\/i\.imgur\.com\/[A-Za-z0-9]+\.(?:jpg|jpeg|gif|png|bmp)\b/g);
          if (!imgurLink) {
            await modalResponse.reply({
              content: 'Invalid icon URL. Please make sure it is a valid imgur image URL.',
              ephemeral: true,
            });
            return;
          }

          await db.hubs.update({
            where: { id: hubInDb?.id },
            data: { iconUrl: imgurLink[0] },
          });

          await modalResponse.reply({
            content: 'Successfully updated icon!',
            ephemeral: true,
          });
          break;
        }

        case 'description': {
          const modal = new ModalBuilder()
            .setCustomId(i.id)
            .setTitle('Edit Hub Description')
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setLabel('Enter Description')
                  .setPlaceholder('A detailed description about the hub.')
                  .setMaxLength(1024)
                  .setStyle(TextInputStyle.Paragraph)
                  .setCustomId('description'),
              ),
            );

          await i.showModal(modal);

          const modalResponse = await i.awaitModalSubmit({
            filter: m => m.customId === modal.data.custom_id,
            time: 60_000 * 5,
          }).catch(e => {
            if (!e.message.includes('ending with reason: time')) {
              logger.error(e);
              captureException(e, {
                user: { id: i.user.id, username: i.user.username },
                extra: { context: 'This happened when user tried to edit hub desc.' },
              });
            }
            return null;
          });

          if (!modalResponse) return;

          const description = modalResponse.fields.getTextInputValue('description');
          await db.hubs.update({
            where: { id: hubInDb?.id },
            data: { description },
          });

          await modalResponse.reply({
            content: 'Successfully updated hub description.',
            ephemeral: true,
          });
          break;
        }

        case 'banner': {
          const modal = new ModalBuilder()
            .setCustomId(i.id)
            .setTitle('Set Hub Banner')
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setLabel('Enter Banner URL')
                  .setPlaceholder('Enter a valid imgur image URL.')
                  .setStyle(TextInputStyle.Short)
                  .setCustomId('banner'),
              ));

          await i.showModal(modal);

          const modalResponse = await i.awaitModalSubmit({
            filter: m => m.customId === modal.data.custom_id,
            time: 60_000 * 5,
          }).catch(e => {
            if (!e.message.includes('ending with reason: time')) {
              logger.error(e);
              captureException(e, {
                user: { id: i.user.id, username: i.user.username },
                extra: { context: 'Occured during hub banner change.' },
              });
            }
            return null;
          });

          if (!modalResponse) return;

          const newBanner = modalResponse.fields.getTextInputValue('banner');
          // check if banner is a valid imgur link
          const imgurLink = newBanner.match(/\bhttps?:\/\/i\.imgur\.com\/[A-Za-z0-9]+\.(?:jpg|jpeg|gif|png|bmp)\b/g);
          if (!imgurLink) {
            await modalResponse.reply({
              content: 'Invalid banner URL. Please make sure it is a valid imgur image URL.',
              ephemeral: true,
            });
            return;
          }

          await db.hubs.update({
            where: { id: hubInDb?.id },
            data: { bannerUrl: imgurLink[0] },
          });

          await modalResponse.reply({
            content: 'Successfully updated banner!',
            ephemeral: true,
          });
          break;
        }

        case 'visibility': {
          await db.hubs.update({
            where: { id: hubInDb?.id },
            data: { private: !hubInDb?.private },
          });
          await i.reply({
            content: `Successfully set hub visibility to **${hubInDb?.private ? 'Public' : 'Private'}**.`,
            ephemeral: true,
          });
          break;
        }

        default:
          break;
      }

      hubInDb = await db.hubs.findFirst({
        where: { id: hubInDb?.id },
        include: { connections: true },
      });
      if (hubInDb) {
        await interaction.editReply({ embeds: [await hubEmbed(hubInDb)] }).catch(() => null);
      }
    });

    collector.on('end', async () => {
      actionsSelect.components[0].setDisabled(true);
      await interaction.editReply({
        components: [actionsSelect],
      }).catch(() => null);
    });
  },
};