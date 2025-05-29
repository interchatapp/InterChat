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

import Logger from '#src/utils/Logger.js';
import type { ClusterClient } from 'discord-hybrid-sharding';
import type {
  ActionRowData,
  APIMessageTopLevelComponent,
  Channel,
  Client,
  EmbedBuilder,
  JSONEncodable,
  MessageActionRowComponentBuilder,
  MessageActionRowComponentData,
  MessageFlags,
  TopLevelComponentData,
} from 'discord.js';

/**
 * Sends a log message to the specified channel with the provided embed.
 * @param channelId The ID of the channel to send the log message to.
 * @param embed The embed object containing the log message.
 * @returns The sent message, if successful.
 */
export const sendLog = async (
  cluster: ClusterClient<Client>,
  channelId: string,
  embed: EmbedBuilder | null,
  opts?: {
    content?: string;
    roleMentionIds?: readonly string[];
    components?: readonly (
      | JSONEncodable<APIMessageTopLevelComponent>
      | TopLevelComponentData
      | ActionRowData<MessageActionRowComponentData>
      | APIMessageTopLevelComponent
      | MessageActionRowComponentBuilder
      | ActionRowData<MessageActionRowComponentData | MessageActionRowComponentBuilder>
    )[];
    flags?: Array<
      MessageFlags.SuppressEmbeds | MessageFlags.SuppressNotifications | MessageFlags.IsComponentsV2
    >;
  },
): Promise<{ id: string } | null> => {
  const result = await cluster
    .broadcastEval(
      async (shardClient, ctx) => {
        const channel = (await shardClient.channels
          .fetch(ctx.channelId)
          .catch(() => null)) as Channel | null;

        if (channel?.isSendable()) {
          const message = await channel
            .send({
              content: ctx.roleMentionIds?.length
                ? `${ctx.roleMentionIds?.map((id) => `<@&${id}>`).join(' ') ?? ''} ${ctx.content ?? ''}`
                : ctx.content,
              embeds: ctx.embed ? [ctx.embed] : undefined,
              components: ctx.components,
              allowedMentions: { roles: ctx.roleMentionIds },
              flags: ctx.flags,
            })
            .catch(() => null);

          if (message) {
            return { id: message.id };
          }
        }
        return null;
      },
      {
        context: {
          channelId,
          embed: embed?.toJSON(),
          content: opts?.content,
          flags: opts?.flags,
          components: opts?.components,
          roleMentionIds: opts?.roleMentionIds,
        },
      },
    )
    .catch((e) => {
      Logger.error(e);
      return null;
    });

  // Find the first non-null result (the message that was actually sent)
  return result?.find((r) => r !== null) ?? null;
};
