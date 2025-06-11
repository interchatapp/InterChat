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
import type HubManager from '#src/managers/HubManager.js';
import { findOriginalMessage } from '#src/utils/network/messageUtils.js';
import type Context from '#src/core/CommandContext/Context.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { t } from '#utils/Locale.js';
import { logMsgDelete } from '#utils/hub/logger/ModLogs.js';
import { isStaffOrHubMod } from '#utils/hub/utils.js';
import { deleteMessageFromHub, isDeleteInProgress } from '#utils/moderation/deleteMessage.js';
import { ApplicationCommandOptionType, ApplicationCommandType } from 'discord.js';
import { replyWithUnknownMessage } from '#src/utils/moderation/modPanel/utils.js';
import { HubService } from '#src/services/HubService.js';
import type { Message as MessageDB } from '#src/generated/prisma/client/client.js';

export default class DeleteMessage extends BaseCommand {
  readonly cooldown = 10_000;
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'deletemsg',
      description: 'Delete a message you sent using interchat.',
      types: {
        prefix: true,
        slash: true,
        contextMenu: {
          name: 'Delete Message',
          type: ApplicationCommandType.Message,
        },
      },
      contexts: { guildOnly: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'message',
          description: 'The message ID or message link of the message to delete',
          required: true,
        },
      ],
    });
  }

  async execute(ctx: Context): Promise<void> {
    if (!ctx.inGuild()) return;

    await ctx.deferReply({ flags: ['Ephemeral'] });

    const targetId = ctx.getTargetMessageId('message');
    const originalMsg = targetId ? await findOriginalMessage(targetId) : null;
    const hub = await this.hubService.fetchHub({ id: originalMsg?.hubId });

    const validation = await this.validateMessage(ctx, originalMsg, hub);
    if (!validation || !originalMsg) return;

    await this.processMessageDeletion(ctx, originalMsg, validation.hub);
  }

  private async processMessageDeletion(
    ctx: Context,
    originalMsg: MessageDB,
    hub: HubManager,
  ): Promise<void> {
    const locale = await fetchUserLocale(ctx.user.id);

    await ctx.editReply(
      t('deleteMsg.processing', locale, {
        emoji: ctx.getEmoji('tick_icon'),
      }),
    );

    const { deletedCount, totalCount } = await deleteMessageFromHub(hub.id, originalMsg.id);

    await ctx
      .editReply(
        t('network.deleteSuccess', locale, {
          emoji: ctx.getEmoji('tick_icon'),
          user: `<@${originalMsg.authorId}>`,
          deleted: `${deletedCount}`,
          total: `${totalCount}`,
        }),
      )
      .catch(() => null);

    await this.logDeletion(ctx, hub, originalMsg);
  }

  private async validateMessage(
    ctx: Context,
    originalMsg: MessageDB | null,
    hub: HubManager | null,
  ) {
    const locale = await fetchUserLocale(ctx.user.id);

    if (!originalMsg || !hub) {
      await replyWithUnknownMessage(ctx);
      return false;
    }

    if (await isDeleteInProgress(originalMsg.id)) {
      await ctx.editReply(
        t('deleteMsg.alreadyDeleted', locale, {
          emoji: ctx.getEmoji('neutral'),
        }),
      );
      return false;
    }

    if (ctx.user.id !== originalMsg.authorId && !(await isStaffOrHubMod(ctx.user.id, hub))) {
      await ctx.editReply(
        t('errors.notMessageAuthor', locale, {
          emoji: ctx.getEmoji('x_icon'),
        }),
      );
      return false;
    }

    return { hub };
  }

  private async logDeletion(
    ctx: Context,
    hub: HubManager,
    originalMsg: MessageDB,
  ): Promise<void> {
    if (!(await isStaffOrHubMod(ctx.user.id, hub))) return;

    await logMsgDelete(ctx.client, originalMsg, await hub.fetchLogConfig(), {
      hubName: hub.data.name,
      modName: ctx.user.username,
    });
  }
}
