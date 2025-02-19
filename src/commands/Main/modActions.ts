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
import type Context from '#src/core/CommandContext/Context.js';
import { buildModPanel } from '#src/interactions/ModPanel.js';
import { HubService } from '#src/services/HubService.js';
import db from '#src/utils/Db.js';
import {
  type OriginalMessage,
  findOriginalMessage,
} from '#src/utils/network/messageUtils.js';
import { isStaffOrHubMod } from '#utils/hub/utils.js';
import { ApplicationCommandOptionType, ApplicationCommandType } from 'discord.js';

export default class ModPanelCommand extends BaseCommand {
  constructor() {
    super({
      name: 'modpanel',
      description: 'Open the moderation actions panel for a message',
      types: {
        slash: true,
        prefix: true,
        contextMenu: {
          name: 'Moderation Actions',
          type: ApplicationCommandType.Message as const,
        },
      },
      contexts: {
        guildOnly: true,
        userInstall: true,
      },
      options: [
        {
          name: 'message',
          description: 'The message to moderate',
          type: ApplicationCommandOptionType.String,
          required: true,
        },
      ],
    });
  }

  async execute(ctx: Context) {
    await ctx.deferReply({ flags: ['Ephemeral'] });
    const targetMsgId = ctx.getTargetMessageId('message');
    if (!targetMsgId) {
      await ctx.replyEmbed('errors.messageNotSentOrExpired', {
        t: { emoji: ctx.getEmoji('x_icon') },
        edit: true,
        flags: ['Ephemeral'],
      });
      return;
    }

    const originalMsg = await findOriginalMessage(targetMsgId);
    if (!originalMsg || !(await this.validateMessage(ctx, originalMsg))) {
      await ctx.replyEmbed('errors.messageNotSentOrExpired', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
        edit: true,
      });
      return;
    }

    const { embed, buttons } = await buildModPanel(ctx, originalMsg);
    await ctx.editOrReply({ embeds: [embed], components: buttons });
  }

  private async validateMessage(ctx: Context, originalMsg: OriginalMessage) {
    const hubService = new HubService(db);
    const hub = await hubService.fetchHub(originalMsg.hubId);

    return Boolean(hub && (await isStaffOrHubMod(ctx.user.id, hub)));
  }
}
