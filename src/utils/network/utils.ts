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

import { Collection, EmbedBuilder, type HexColorString, type Message } from 'discord.js';
import {
  type OriginalMessage,
  findOriginalMessage,
  getBroadcasts,
} from '#src/utils/network/messageUtils.js';
import Constants from '#utils/Constants.js';
import { stripTenorLinks } from '#utils/ImageUtils.js';
import { censor } from '#utils/ProfanityUtils.js';
import type { ReferredMsgData } from './Types.js';
import { fetchUserData } from '#src/utils/Utils.js';

/**
 * Retrieves the content of a referred message, which can be either the message's text content or the description of its first embed.
 * If the referred message has no content, returns a default message indicating that the original message contains an attachment.
 * If the referred message's content exceeds 1000 characters, truncates it and appends an ellipsis.
 * @param referredMessage The message being referred to.
 * @param parseMode The mode in which the original message was sent in.
 * @returns The content of the referred message.
 */
export const getReferredContent = (originalMsg: OriginalMessage) =>
  originalMsg.content.length > 0
    ? originalMsg.content
    : '*Original message contains attachment <:attachment:1102464803647275028>*';

export const getReferredMsgData = async (
  referredMessage: Message | null,
): Promise<ReferredMsgData> => {
  if (!referredMessage) {
    return {
      dbReferrence: null,
      referredAuthor: null,
      dbReferredAuthor: null,
    };
  }

  const { client } = referredMessage;

  // check if it was sent in the network
  const dbReferrenceRaw = await findOriginalMessage(referredMessage.id);

  if (!dbReferrenceRaw) {
    return {
      dbReferrence: null,
      referredAuthor: null,
      dbReferredAuthor: null,
    };
  }

  // fetch the acttual user ("referredMessage" is a webhook message)
  const referredAuthor = await client.users.fetch(dbReferrenceRaw.authorId).catch(() => null);
  const dbReferredAuthor = await fetchUserData(dbReferrenceRaw.authorId);
  const broadcastedMessages = await getBroadcasts(dbReferrenceRaw.messageId, dbReferrenceRaw.hubId);

  const dbReferrence = {
    ...dbReferrenceRaw,
    broadcastMsgs: new Collection(Object.values(broadcastedMessages).map((m) => [m.channelId, m])),
  };

  return { dbReferrence, referredAuthor, dbReferredAuthor, referredMessage };
};

const processContent = (
  content: string,
  censoredContent: string,
  attachmentURL?: string | null,
) => {
  let msgContent = content;
  let censoredMsg = censoredContent;

  if (attachmentURL) {
    msgContent = stripTenorLinks(msgContent, attachmentURL);
    censoredMsg = stripTenorLinks(censoredContent, attachmentURL);
  }

  return { msgContent, censoredMsg };
};

const createEmbed = (
  message: Message,
  username: string,
  content: string,
  opts?: {
    attachmentURL?: string | null;
    embedCol?: HexColorString;
  },
) =>
  new EmbedBuilder()
    .setImage(opts?.attachmentURL ?? null)
    .setColor(opts?.embedCol ?? Constants.Colors.invisible)
    .setAuthor({
      name: username,
      iconURL: message.author.displayAvatarURL(),
    })
    .setDescription(content || null)
    .setFooter({
      text: `From: ${message.guild?.name}`,
      iconURL: message.guild?.iconURL() ?? undefined,
    });

const createCensoredEmbed = (embed: EmbedBuilder, censoredContent: string) =>
  EmbedBuilder.from(embed).setDescription(censoredContent || null);

const addReplyField = (normal: EmbedBuilder, censored: EmbedBuilder, referredContent: string) => {
  const formattedReply = referredContent.replaceAll('\n', '\n> ');
  normal.setFields({ name: 'Replying To:', value: `> ${formattedReply}` });
  censored.setFields({
    name: 'Replying To:',
    value: `> ${censor(formattedReply)}`,
  });
};

/**
 * Builds an embed for a network message.
 * @param message The network message to build the embed for.
 * @param opts Optional parameters for the embed.
 * @param opts.attachmentURL The URL of the attachment to include in the embed.
 * @param opts.embedCol The color of the embed.
 * @param opts.referredContent The content of the message being replied to.
 * @param opts.useNicknames Whether to use nicknames instead of usernames in the embed.
 * @returns An object containing the built EmbedBuilder and its censored version.
 */
export const buildNetworkEmbed = (
  message: Message,
  username: string,
  censoredContent: string,
  opts?: {
    attachmentURL?: string | null;
    embedCol?: HexColorString;
    referredContent?: string;
  },
) => {
  const { msgContent, censoredMsg } = processContent(
    message.content,
    censoredContent,
    opts?.attachmentURL,
  );

  const normal = createEmbed(message, username, msgContent, opts);
  const censored = createCensoredEmbed(normal, censoredMsg);

  if (opts?.referredContent) {
    addReplyField(normal, censored, opts.referredContent);
  }

  return { normal, censored };
};
