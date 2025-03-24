import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { buildModPanel } from '#src/interactions/ModPanel.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { t, type supportedLocaleCodes } from '#src/utils/Locale.js';
import { warnUser } from '#src/utils/moderation/warnUtils.js';
import { findOriginalMessage } from '#src/utils/network/messageUtils.js';
import { ModalSubmitInteraction } from 'discord.js';

export default class WarnModalHandler {
  /**
   * ### WARNING:
   * This function does NOT check if the user is hub mod. It is assumed that
   * the interaction will only be called by `interactions/ModPanel.ts`,
   * and that it has already done the necessary checks.
   */
  @RegisterInteractionHandler('warnModal')
  async handleModal(interaction: ModalSubmitInteraction) {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [userId, hubId] = customId.args;
    const reason = interaction.fields.getTextInputValue('reason');

    await warnUser({
      userId,
      hubId,
      reason,
      moderatorId: interaction.user.id,
      client: interaction.client,
    });

    const originalMsg = await findOriginalMessage(userId);
    if (!originalMsg) {
      return;
    }

    await interaction.followUp({
      content: t('warn.success', interaction.locale as supportedLocaleCodes, {
        emoji: getEmoji('tick_icon', interaction.client),
        name: (await interaction.client.users.fetch(userId)).username,
      }),
      flags: ['Ephemeral'],
    });

    const { embed, buttons } = await buildModPanel(interaction, originalMsg);
    await interaction.editReply({ embeds: [embed], components: buttons });
  }
}
