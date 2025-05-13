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
import { buildReportReasonDropdown } from '#src/interactions/ReportMessage.js';
import { findOriginalMessage, getBroadcasts } from '#src/utils/network/messageUtils.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { ApplicationCommandOptionType } from 'discord.js';

export default class ReportPrefixCommand extends BaseCommand {
  constructor() {
    super({
      name: 'report',
      description: 'Report a message',
      types: { slash: true, prefix: true },
      options: [
        {
          name: 'message',
          description: 'The message to report',
          type: ApplicationCommandOptionType.String,
          required: true,
        },
      ],
    });
  }

  async execute(ctx: Context) {
    const targetMsg = await ctx.getTargetMessage('message');
    const originalMsg = targetMsg ? await findOriginalMessage(targetMsg.id) : null;
    const broadcastMsgs = originalMsg
      ? await getBroadcasts(originalMsg.id)
      : null;

    if (!broadcastMsgs || !originalMsg || !targetMsg) {
      await ctx.reply('Please provide a valid message ID or link.');
      return;
    }

    const reportedMsgId =
      Object.values(broadcastMsgs).find((m) => m.messageId === targetMsg.id)?.messageId ??
      originalMsg.id;

    if (!reportedMsgId) {
      await ctx.reply('Please provide a valid message ID or link.');
      return;
    }

    const locale = await fetchUserLocale(ctx.user.id);
    const selectMenu = buildReportReasonDropdown(reportedMsgId, locale);

    await ctx.reply({
      content: `${ctx.getEmoji('info_icon')} Please select a reason for your report:`,
      components: [selectMenu],
      flags: ['Ephemeral'],
    });
  }
}
