import { showInbox } from '#src/commands/Main/inbox.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import UserDbService from '#src/services/UserDbService.js';
import { CustomID } from '#src/utils/CustomID.js';
import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';

export const openInboxButton =
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(new CustomID().setIdentifier('openInbox').toString())
      .setLabel('Open Inbox')
      .setEmoji('📬')
      .setStyle(ButtonStyle.Secondary),
  );

export default class OpenInboxButtonHandler {
  private readonly userDbService = new UserDbService();

  @RegisterInteractionHandler('openInbox')
  async execute(interaction: ButtonInteraction) {
    await showInbox(interaction, { userDbService: this.userDbService, ephemeral: true });
  }
}
