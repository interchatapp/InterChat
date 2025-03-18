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
import { EmbedBuilder, type Message, type WebhookMessageCreateOptions } from 'discord.js';
import Constants from '#src/utils/Constants.js';
import type { DefaultFormaterOpts, MessageFormatterStrategy } from '../MessageFormattingService.js';

export class CompactMessageFormatter implements MessageFormatterStrategy {
  format(
    message: Message<true>,
    connection: Connection,
    opts: DefaultFormaterOpts,
  ): WebhookMessageCreateOptions {
    const contents = {
      normal: message.content,
      referred: opts.referredContent,
    };
    const { referredAuthor } = opts.referredMsgData;


    // discord displays either an embed or an attachment url in a compact message (embeds take priority, so image will not display)
    // which is why if there is an image, we don't send the reply embed. Reply button remains though
    const replyEmbed =
    contents.referred && !opts.attachmentURL
      ? [
        new EmbedBuilder()
          .setDescription(contents.referred)
          .setAuthor({
            name: referredAuthor?.username.slice(0, 30) ?? 'Unknown User',
            iconURL: referredAuthor?.displayAvatarURL(),
          })
          .setColor(Constants.Colors.invisible),
      ]
      : undefined;

    const { author, servername, jumpButton } = opts;

    // compact mode doesn't need new attachment url for tenor and direct image links
    // we can just slap them right in the content without any problems
    // [] has an empty char in between its not magic kthxbye
    const attachmentURL =
      message.attachments.size > 0 || message.stickers.size > 0
        ? `\n[⁥](${opts.attachmentURL})`
        : '';

    return {
      username: `@${author.username} • ${servername}`,
      avatarURL: author.avatarURL,
      embeds: replyEmbed,
      components: jumpButton,
      content: `${opts.badges}${contents.normal} ${attachmentURL}`,
      threadId: connection.parentId ? connection.channelId : undefined,
      allowedMentions: { parse: [] },
    };
  }
}
