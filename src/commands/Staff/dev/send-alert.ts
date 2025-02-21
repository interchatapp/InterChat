import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import Constants from '#src/utils/Constants.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import {
  ActionRowBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export default class DevAnnounceCommand extends BaseCommand {
  constructor() {
    super({
      name: 'send-alert',
      description: 'Alert something to all users. This will go to their inbox.',
      types: { slash: true, prefix: true },
    });
  }
  async execute(ctx: Context) {
    const modal = new ModalBuilder()
      .setCustomId(new CustomID('devAnnounceModal').toString())
      .setTitle('Announcement Creation')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('title')
            .setLabel('Title')
            .setMaxLength(100)
            .setRequired(true)
            .setStyle(TextInputStyle.Short),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('content')
            .setLabel('Content of the announcement')
            .setMaxLength(4000)
            .setRequired(true)
            .setStyle(TextInputStyle.Paragraph),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('thumbnailUrl')
            .setLabel('Thumbnail URL')
            .setRequired(false)
            .setStyle(TextInputStyle.Short),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('bannerUrl')
            .setLabel('Banner URL')
            .setRequired(false)
            .setStyle(TextInputStyle.Short),
        ),
      );

    await ctx.showModal(modal);
  }

  @RegisterInteractionHandler('devAnnounceModal')
  async handleModal(interaction: ModalSubmitInteraction) {
    const title = interaction.fields.getTextInputValue('title');
    const content = interaction.fields.getTextInputValue('content');
    const thumbnailUrlInput = interaction.fields.getTextInputValue('thumbnailUrl');
    const imageUrlInput = interaction.fields.getTextInputValue('bannerUrl');

    const thumbnailUrl = thumbnailUrlInput.length > 0 ? thumbnailUrlInput : null;
    const imageUrl = imageUrlInput.length > 0 ? imageUrlInput : null;

    const testThumbnail =
      thumbnailUrlInput.length > 0 ? Constants.Regex.ImageURL.test(thumbnailUrlInput) : true;
    const testImage =
      imageUrlInput.length > 0 ? Constants.Regex.ImageURL.test(imageUrlInput) : true;

    if (!testThumbnail || !testImage) {
      await interaction.reply({
        content: `${getEmoji('x_icon', interaction.client)} Thumbnail or Icon URL is invalid.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    await db.announcement.create({
      data: { title, content, thumbnailUrl, imageUrl },
    });

    await interaction.reply(
      `${getEmoji('tick_icon', interaction.client)} Announcement has been recorded. View using \`/inbox\``,
    );
  }
}
