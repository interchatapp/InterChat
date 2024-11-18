import { RegisterInteractionHandler } from '#main/decorators/RegisterInteractionHandler.js';
import { HubService } from '#main/services/HubService.js';
import { setComponentExpiry } from '#utils/ComponentUtils.js';
import { emojis } from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { t } from '#utils/Locale.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import HubCommand from './index.js';

export default class Delete extends HubCommand {
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const hubName = interaction.options.getString('hub', true);
    const hubInDb = await db.hub.findFirst({ where: { name: hubName } });
    const { userManager } = interaction.client;
    const locale = await userManager.getUserLocale(interaction.user.id);

    if (interaction.user.id !== hubInDb?.ownerId) {
      await interaction.reply({
        content: t('hub.delete.ownerOnly', locale, { emoji: emojis.no }),
        ephemeral: true,
      });
      return;
    }

    const confirmEmbed = new EmbedBuilder()
      .setDescription(t('hub.delete.confirm', locale, { hub: hubInDb.name }))
      .setColor('Red');
    const confirmButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Confirm')
        .setCustomId(
          new CustomID()
            .setIdentifier('hub_delete', 'confirm')
            .addArgs(interaction.user.id)
            .addArgs(hubInDb.id)
            .toString(),
        )
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setLabel('Cancel')
        .setCustomId(
          new CustomID()
            .setIdentifier('hub_delete', 'cancel')
            .addArgs(interaction.user.id)
            .addArgs(hubInDb.id)
            .toString(),
        )
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      embeds: [confirmEmbed],
      components: [confirmButtons],
    });

    setComponentExpiry(interaction.client.getScheduler(), await interaction.fetchReply(), 10_000);
  }

  @RegisterInteractionHandler('hub_delete')
  override async handleComponents(interaction: ButtonInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [userId, hubId] = customId.args;
    const { userManager } = interaction.client;
    const locale = await userManager.getUserLocale(interaction.user.id);

    if (interaction.user.id !== userId) {
      const infoEmbed = new InfoEmbed().setDescription(
        t('hub.delete.ownerOnly', locale, { emoji: emojis.no }),
      );

      await interaction.reply({ embeds: [infoEmbed], ephemeral: true });
      return;
    }

    if (customId.suffix === 'cancel') {
      const infoEmbed = new InfoEmbed().setDescription(
        t('hub.delete.cancelled', locale, { emoji: emojis.no }),
      );

      await interaction.update({ embeds: [infoEmbed], components: [] });
      return;
    }

    const embed = new InfoEmbed().setDescription(
      t('misc.loading', locale, { emoji: emojis.loading }),
    );

    await interaction.update({ embeds: [embed], components: [] });

    const hubService = new HubService(db);
    const hubInDb = await hubService.fetchHub(hubId);

    // only the owner can delete the hub
    if (hubInDb?.ownerId !== interaction.user.id) {
      const infoEmbed = new InfoEmbed().setDescription(
        t('hub.notFound', locale, { emoji: emojis.no }),
      );

      await interaction.editReply({ embeds: [infoEmbed] });
      return;
    }

    // Delete the hub and all related data
    await hubService.deleteHub(hubInDb.id);

    await interaction.editReply({
      content: t('hub.delete.success', locale, { emoji: emojis.tick, hub: hubInDb.name }),
      embeds: [],
    });
  }
}
