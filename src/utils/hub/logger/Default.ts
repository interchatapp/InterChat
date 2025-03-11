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

import type { ClusterClient } from 'discord-hybrid-sharding';
import type {
  APIActionRowComponent,
  APIMessageActionRowComponent,
  Channel,
  Client,
  EmbedBuilder,
} from 'discord.js';

/**
 * Sends a log message to the specified channel with the provided embed.
 * @param channelId The ID of the channel to send the log message to.
 * @param embed The embed object containing the log message.
 */
export const sendLog = async (
  cluster: ClusterClient<Client>,
  channelId: string,
  embed: EmbedBuilder,
  opts?: {
    content?: string;
    roleMentionIds?: readonly string[];
    components?: APIActionRowComponent<APIMessageActionRowComponent>[];
  },
) => {
  await cluster.broadcastEval(
    async (shardClient, ctx) => {
      const channel = (await shardClient.channels
        .fetch(ctx.channelId)
        .catch(() => null)) as Channel | null;

      if (channel?.isSendable()) {
        await channel
          .send({
            content: `${ctx.roleMentionIds?.map((id) => `<@&${id}>`).join(' ') ?? ''} ${ctx.content ?? ''}`,
            embeds: [ctx.embed],
            components: ctx.components,
            allowedMentions: { roles: ctx.roleMentionIds },
          })
          .catch(() => null);
      }
    },
    {
      context: {
        channelId,
        embed: embed.toJSON(),
        content: opts?.content,
        components: opts?.components,
        roleMentionIds: opts?.roleMentionIds,
      },
    },
  );
};
