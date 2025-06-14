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
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import type Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import type { Message as MessageDB } from '#src/generated/prisma/client/client.js';
import type HubManager from '#src/managers/HubManager.js';
import { HubService } from '#src/services/HubService.js';
import { CustomID } from '#src/utils/CustomID.js';
import { handleError } from '#src/utils/Utils.js';
import { replyWithUnknownMessage } from '#src/utils/moderation/modPanel/utils.js';
import { findOriginalMessage } from '#src/utils/network/messageUtils.js';
import { t } from '#utils/Locale.js';
import { logMsgEdit } from '#utils/hub/logger/MsgLogs.js';
import { isStaffOrHubMod } from '#utils/hub/utils.js';
import { editMessageInHub, isEditInProgress } from '#utils/moderation/editMessage.js';
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

const EDIT_MSG_MODAL_ID = 'editMsgModal';

export default class EditMessage extends BaseCommand {
  readonly cooldown = 10_000;
  private readonly hubService = new HubService();

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
          description: 'The message ID or message link of the message to edit',
          required: true,
        },
      ],
    });
  }

  async execute(ctx: Context): Promise<void> {
    if (!ctx.inGuild()) return;

    const targetId = ctx.getTargetMessageId('message');
    const originalMsg = targetId ? await findOriginalMessage(targetId) : null;
    const hub = await this.hubService.fetchHub({ id: originalMsg?.hubId });

    const validation = await this.validateMessage(ctx, originalMsg, hub);
    if (!validation || !originalMsg) return;

    await this.showEditModal(ctx, originalMsg);
  }

  private async showEditModal(ctx: Context, originalMsg: MessageDB): Promise<void> {
    const locale = await ctx.getLocale();

    // Create a modal for editing the message
    const modal = new ModalBuilder()
      .setCustomId(new CustomID(EDIT_MSG_MODAL_ID, [originalMsg.id]).toString())
      .setTitle(t('editMsg.modal.title', locale));

    // Create a text input for the new message content
    const contentInput = new TextInputBuilder()
      .setCustomId('content')
      .setLabel(t('editMsg.modal.content.label', locale))
      .setPlaceholder(t('editMsg.modal.content.placeholder', locale))
      .setStyle(TextInputStyle.Paragraph)
      .setValue(originalMsg.content)
      .setRequired(true)
      .setMaxLength(2000);

    // Add the text input to an action row
    const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput);

    // Add the action row to the modal
    modal.addComponents(actionRow);

    try {
      // Only show modal if it's an interaction that supports it
      if ('showModal' in ctx.interaction) {
        await ctx.interaction.showModal(modal);
      }
    }
    catch (e) {
      await ctx.editReply(
        t('errors.modalError', locale, {
          emoji: ctx.getEmoji('x_icon'),
        }),
      );
      handleError(e);
    }
  }

  @RegisterInteractionHandler(EDIT_MSG_MODAL_ID)
  async handleModalSubmission(ctx: ComponentContext): Promise<void> {
    if (!ctx.isModalSubmit()) return;

    await ctx.deferUpdate();

    const originalMsgId = ctx.customId.args[0];
    const newContent = ctx.getModalFieldValue('content');

    if (!newContent || newContent.trim().length === 0) {
      const locale = await ctx.getLocale();
      await ctx.editReply(
        t('network.emptyContent', locale, {
          emoji: ctx.getEmoji('x_icon'),
        }) || `${ctx.getEmoji('x_icon')} Message content cannot be empty.`,
      );
      return;
    }

    const originalMsg = await findOriginalMessage(originalMsgId);
    const hub = await this.hubService.fetchHub({ id: originalMsg?.hubId });

    if (!originalMsg || !hub) {
      await replyWithUnknownMessage(ctx);
      return;
    }

    await this.processMessageEdit(ctx, originalMsg, hub, newContent);
  }

  private async processMessageEdit(
    ctx: ComponentContext,
    originalMsg: MessageDB,
    hub: HubManager,
    newContent: string,
  ): Promise<void> {
    const locale = await ctx.getLocale();

    await ctx.reply(
      t('editMsg.processing', locale, {
        emoji: ctx.getEmoji('loading'),
      }),
    );

    const { editedCount, totalCount } = await editMessageInHub(
      hub.id,
      originalMsg.id,
      newContent,
      originalMsg.imageUrl,
    );

    await ctx
      .editReply(
        t('network.editSuccess', locale, {
          emoji: ctx.getEmoji('tick_icon'),
          user: `<@${originalMsg.authorId}>`,
          edited: `${editedCount}`,
          total: `${totalCount}`,
        }) ||
          `${ctx.getEmoji('tick_icon')} Successfully edited ${editedCount}/${totalCount} messages from <@${originalMsg.authorId}>.`,
      )
      .catch(() => null);

    await this.logEdit(ctx, hub, originalMsg, newContent);
  }

  private async validateMessage(
    ctx: Context,
    originalMsg: MessageDB | null,
    hub: HubManager | null,
  ) {
    const locale = await ctx.getLocale();

    if (!originalMsg || !hub) {
      await replyWithUnknownMessage(ctx);
      return false;
    }

    if (await isEditInProgress(originalMsg.id)) {
      await ctx.editReply(
        t('editMsg.alreadyEdited', locale, {
          emoji: ctx.getEmoji('neutral'),
        }),
      );
      return false;
    }

    if (ctx.user.id !== originalMsg.authorId && !(await isStaffOrHubMod(ctx.user.id, hub))) {
      await ctx.editReply(
        t('errors.notMessageAuthor', locale, {
          emoji: ctx.getEmoji('x_icon'),
        }) || `${ctx.getEmoji('x_icon')} You can only edit your own messages.`,
      );
      return false;
    }

    return { hub };
  }

  private async logEdit(
    ctx: ComponentContext,
    hub: HubManager,
    originalMsg: MessageDB,
    newContent: string,
  ): Promise<void> {
    if (!(await isStaffOrHubMod(ctx.user.id, hub))) return;

    await logMsgEdit(ctx.client, originalMsg, newContent, await hub.fetchLogConfig(), {
      hubName: hub.data.name,
      modName: ctx.user.username,
    });
  }
}
