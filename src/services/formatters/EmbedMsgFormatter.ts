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

import type { Connection } from '@prisma/client';
import type { Message, WebhookMessageCreateOptions } from 'discord.js';
import { buildNetworkEmbed } from '#src/utils/network/utils.js';
import type { DefaultFormaterOpts, MessageFormatterStrategy } from '../MessageFormattingService.js';

export class EmbedMessageFormatter implements MessageFormatterStrategy {
  format(
    message: Message<true>,
    connection: Connection,
    opts: DefaultFormaterOpts,
  ): WebhookMessageCreateOptions {
    const embed = buildNetworkEmbed(message, opts.username, {
      attachmentURL: opts.attachmentURL,
      referredContent: opts.referredContent,
      embedCol: opts.embedColor,
    });

    return {
      components: opts.jumpButton,
      embeds: [embed],
      username: `${opts.hub.name}`,
      avatarURL: opts.hub.iconUrl,
      threadId: connection.parentId ? connection.channelId : undefined,
      allowedMentions: { parse: [] },
    };
  }
}
