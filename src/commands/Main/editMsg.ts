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

import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  EmbedBuilder,
  type Message,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  type User,
  userMention,
} from 'discord.js';
/* eslint-disable complexity */
import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import type { SerializedHubSettings } from '#src/modules/BitFields.js';
import VoteBasedLimiter from '#src/modules/VoteBasedLimiter.js';
import { HubService } from '#src/services/HubService.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { replyWithUnknownMessage } from '#src/utils/moderation/modPanel/utils.js';
import {
  findOriginalMessage,
  getBroadcast,
  getBroadcasts,
} from '#src/utils/network/messageUtils.js';
import Constants, { ConnectionMode } from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { getAttachmentURL } from '#utils/ImageUtils.js';
import { t } from '#utils/Locale.js';
import { containsInviteLinks, fetchUserLocale, handleError, replaceLinks } from '#utils/Utils.js';

interface ImageUrls {
  oldURL?: string | null;
  newURL?: string | null;
}

export default class EditMessage extends BaseCommand {
  constructor() {
    super({
      name: 'editmsg',
      description: 'Edit a message you sent using interchat.',
      types: {
        prefix: true,
        slash: true,
        contextMenu: {
          name: 'Edit Message',
          type: ApplicationCommandType.Message,
        },
      },
      contexts: { guildOnly: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'message',
          description: 'The message to edit',
          required: true,
        },
      ],
    });
  }

  // FIXME: Implement cooldown
  readonly cooldown = 10_000;

  async execute(ctx: Context): Promise<void> {
    const target = await ctx.getTargetMessage('message');
    const locale = await fetchUserLocale(ctx.user.id);
    const voteLimiter = new VoteBasedLimiter('editMsg', ctx.user.id);

    if (await voteLimiter.hasExceededLimit()) {
      await ctx.reply({
        content: `${ctx.getEmoji('topggSparkles')} You've hit your daily limit for message edits. [Vote for InterChat](${Constants.Links.Vote}) on top.gg to get unlimited edits!`,
      });
      return;
    }

    const messageInDb = target ? await findOriginalMessage(target.id) : undefined;
    if (!target || !messageInDb) {
      await replyWithUnknownMessage(ctx);
      return;
    }
    if (ctx.user.id !== messageInDb.authorId) {
      await ctx.reply({
        content: t('errors.notMessageAuthor', locale, {
          emoji: ctx.getEmoji('x_icon'),
        }),
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(new CustomID().setIdentifier('editMsg').setArgs(target.id).toString())
      .setTitle('Edit Message')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setRequired(true)
            .setCustomId('newMessage')
            .setStyle(TextInputStyle.Paragraph)
            .setLabel('Please enter your new message.')
            .setValue(messageInDb.content)
            .setMaxLength(950),
        ),
      );

    await ctx.showModal(modal);
  }

  @RegisterInteractionHandler('editMsg')
  async handleModals(interaction: ModalSubmitInteraction): Promise<void> {
    // Defer the reply to give the user feedback
    await interaction.deferReply({ flags: ['Ephemeral'] });

    // Parse the custom ID to get the message ID
    const customId = CustomID.parseCustomId(interaction.customId);
    const [messageId] = customId.args;

    // Fetch the original message
    const target = await interaction.channel?.messages.fetch(messageId).catch(() => null);
    if (!target) {
      await replyWithUnknownMessage(interaction, {
        locale: await fetchUserLocale(interaction.user.id),
      });
      return;
    }

    // Get the original message data
    const originalMsgData = await findOriginalMessage(target.id);

    if (!originalMsgData?.hubId) {
      await replyWithUnknownMessage(interaction, {
        locale: await fetchUserLocale(interaction.user.id),
      });
      return;
    }

    // Fetch the hub information
    const hubService = new HubService(db);
    const hub = await hubService.fetchHub(originalMsgData.hubId);
    if (!hub) {
      await replyWithUnknownMessage(interaction, {
        locale: await fetchUserLocale(interaction.user.id),
      });
      return;
    }

    // Get the new message input from the user
    const userInput = interaction.fields.getTextInputValue('newMessage');
    const messageToEdit = this.sanitizeMessage(userInput, hub.settings.getAll());

    // Check if the message contains invite links
    if (hub.settings.has('BlockInvites') && containsInviteLinks(messageToEdit)) {
      await interaction.editReply(
        t('errors.inviteLinks', await fetchUserLocale(interaction.user.id), {
          emoji: getEmoji('x_icon', interaction.client),
        }),
      );
      return;
    }

    const mode =
      target.id === originalMsgData.messageId
        ? ConnectionMode.Compact
        : ((
          await getBroadcast(originalMsgData?.messageId, originalMsgData?.hubId, {
            channelId: target.channelId,
          })
        )?.mode ?? ConnectionMode.Compact);

    // Prepare the new message contents and embeds
    const imageURLs = await this.getImageURLs(target, mode, messageToEdit);
    const newContent = this.getCompactContents(messageToEdit, imageURLs);
    const newEmbed = await this.buildEmbeds(target, mode, messageToEdit, {
      guildId: originalMsgData.guildId,
      user: interaction.user,
      imageURLs,
    });

    // Find all the messages that need to be edited
    const broadcastedMsgs = Object.values(await getBroadcasts(target.id, originalMsgData.hubId));
    const channelSettingsArr = await db.connection.findMany({
      where: { channelId: { in: broadcastedMsgs.map((c) => c.channelId) } },
    });

    let counter = 0;
    for (const msg of broadcastedMsgs) {
      const connection = channelSettingsArr.find((c) => c.channelId === msg.channelId);
      if (!connection) continue;

      const webhook = await interaction.client
        .fetchWebhook(connection.webhookURL.split('/')[connection.webhookURL.split('/').length - 2])
        .catch(() => null);

      if (webhook?.owner?.id !== interaction.client.user.id) continue;

      let content: string | null = null;
      let embeds: EmbedBuilder[] = [];
      if (msg.mode === ConnectionMode.Embed) {
        embeds = [newEmbed];
      }
      else {
        content = newContent;
      }

      // Edit the message
      const edited = await webhook
        .editMessage(msg.messageId, {
          content,
          embeds,
          threadId: connection.parentId ? connection.channelId : undefined,
        })
        .catch(() => null);

      if (edited) counter++;
    }

    // Update the reply with the edit results
    await interaction
      .editReply(
        t('network.editSuccess', await fetchUserLocale(interaction.user.id), {
          edited: counter.toString(),
          total: broadcastedMsgs.length.toString(),
          emoji: getEmoji('tick_icon', interaction.client),
          user: userMention(originalMsgData.authorId),
        }),
      )
      .catch(handleError);

    // Decrement the vote limiter
    const voteLimiter = new VoteBasedLimiter('editMsg', interaction.user.id);
    await voteLimiter.decrementUses();
  }

  private async getImageURLs(
    target: Message,
    mode: ConnectionMode,
    newMessage: string,
  ): Promise<ImageUrls> {
    const oldURL =
      mode === ConnectionMode.Compact
        ? await getAttachmentURL(target.content)
        : target.embeds[0]?.image?.url;

    const newURL = await getAttachmentURL(newMessage);

    return { oldURL, newURL };
  }

  private async buildEmbeds(
    target: Message,
    mode: ConnectionMode,
    messageToEdit: string,
    opts: { user: User; guildId: string; imageURLs?: ImageUrls },
  ) {
    let embedContent = messageToEdit;
    let embedImage = null;

    // This if check must come on top of the next one at all times
    // because we want newImage Url to be given priority for the embedImage
    if (opts.imageURLs?.newURL) {
      embedContent = embedContent.replace(opts.imageURLs.newURL, '');
      embedImage = opts.imageURLs.newURL;
    }
    if (opts.imageURLs?.oldURL) {
      embedContent = embedContent.replace(opts.imageURLs.oldURL, '');
      embedImage = opts.imageURLs.oldURL;
    }

    let embed: EmbedBuilder;

    if (mode === ConnectionMode.Embed) {
      // utilize the embed directly from the message
      embed = EmbedBuilder.from(target.embeds[0]).setDescription(embedContent).setImage(embedImage);
    }
    else {
      const guild = await target.client.fetchGuild(opts.guildId);

      // create a new embed if the message being edited is in compact mode
      embed = new EmbedBuilder()
        .setAuthor({
          name: opts.user.username,
          iconURL: opts.user.displayAvatarURL(),
        })
        .setDescription(embedContent)
        .setColor(Constants.Colors.invisible)
        .setImage(embedImage)
        .addFields(
          target.embeds.at(0)?.fields.at(0)
            ? [
              {
                name: 'Replying-to',
                value: `${target.embeds[0].description}`,
              },
            ]
            : [],
        )
        .setFooter({ text: `Server: ${guild?.name}` });
    }
    return embed;
  }

  private sanitizeMessage(content: string, settings: SerializedHubSettings) {
    const newMessage = settings.HideLinks ? replaceLinks(content) : content;
    return newMessage;
  }

  private getCompactContents(messageToEdit: string, imageUrls: ImageUrls) {
    let compactMsg = messageToEdit;

    if (imageUrls.oldURL && imageUrls.newURL) {
      // use the new url instead
      compactMsg = compactMsg.replace(imageUrls.oldURL, imageUrls.newURL);
    }

    return compactMsg;
  }
}
