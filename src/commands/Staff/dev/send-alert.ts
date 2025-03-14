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

import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import Constants from '#src/utils/Constants.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { isDev } from '#src/utils/Utils.js';
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
      staffOnly: true,
      name: 'send-alert',
      description: 'Alert something to all users. This will go to their inbox.',
      types: { slash: true, prefix: true },
    });
  }
  async execute(ctx: Context) {
    if (!isDev(ctx.user.id)) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} You don't have permission to use this command.`,
        flags: ['Ephemeral'],
      });
      return;
    }
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
