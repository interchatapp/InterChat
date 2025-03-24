import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { handleBan } from '#src/utils/BanUtils.js';
import { CustomID } from '#src/utils/CustomID.js';
import { ModalSubmitInteraction } from 'discord.js';

export default class WarnModalHandler {
  @RegisterInteractionHandler('userBanModal')
  async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [userId] = customId.args;

    const user = await interaction.client.users.fetch(userId).catch(() => null);
    const reason = interaction.fields.getTextInputValue('reason');

    await handleBan(interaction, userId, user, reason);
  }
}
