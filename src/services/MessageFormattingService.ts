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

import type { Connection, Hub } from '@prisma/client';
import {
  type ActionRowBuilder,
  type ButtonBuilder,
  type Message,
  type WebhookMessageCreateOptions,
  userMention,
} from 'discord.js';
import type { BroadcastOpts, ReferredMsgData } from '#utils/network/Types.js';
import { CompactMessageFormatter } from './formatters/CompactMsgFormatter.js';
import { EmbedMessageFormatter } from './formatters/EmbedMsgFormatter.js';

export interface MessageFormatterStrategy {
  format(
    message: Message<true>,
    connection: Connection,
    opts: DefaultFormaterOpts,
  ): WebhookMessageCreateOptions;
}

export type DefaultFormaterOpts = BroadcastOpts & {
  username: string;
  referredContent: string | undefined;
  servername: string;
  author: {
    username: string;
    avatarURL: string;
  };
  hub: Hub;
  jumpButton?: ActionRowBuilder<ButtonBuilder>[];
  badges?: string;
};

export default class MessageFormattingService {
  private readonly strategy: MessageFormatterStrategy;
  private readonly connection: Connection;

  constructor(connection: Connection) {
    this.strategy = connection.compact
      ? new CompactMessageFormatter()
      : new EmbedMessageFormatter();
    this.connection = connection;
  }

  format(message: Message<true>, opts: DefaultFormaterOpts): WebhookMessageCreateOptions {
    const formatted = this.strategy.format(message, this.connection, opts);
    return this.addReplyMention(formatted, this.connection, opts.referredMsgData);
  }
  private addReplyMention(
    messageFormat: WebhookMessageCreateOptions,
    connection: Connection,
    referredMsgData?: ReferredMsgData,
  ): WebhookMessageCreateOptions {
    if (referredMsgData && connection.serverId === referredMsgData.dbReferrence?.guildId) {
      const { dbReferredAuthor, dbReferrence } = referredMsgData;
      const replyMention = dbReferredAuthor?.mentionOnReply ? userMention(dbReferredAuthor.id) : '';

      messageFormat.content = `${replyMention} ${messageFormat.content ?? ''}`;
      messageFormat.allowedMentions = {
        ...messageFormat.allowedMentions,
        users: [...(messageFormat.allowedMentions?.users ?? []), dbReferrence.authorId],
      };
    }

    return messageFormat;
  }
}
