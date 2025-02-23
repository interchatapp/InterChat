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

import { stripIndents } from 'common-tags';
import {
  AuditLogEvent,
  ChannelType,
  type ColorResolvable,
  EmbedBuilder,
  type Guild,
  type TextChannel,
  type User,
} from 'discord.js';
import Constants from '#utils/Constants.js';

/**
 * Retrieves the first channel in a guild or the inviter of the bot.
 * @param guild The guild to retrieve the target for.
 * @returns The greeting target, which can be a TextChannel or a User.
 */
export const getGuildOwnerOrFirstChannel = async (
  guild: Guild,
): Promise<{ guildOwner: User | null; guildChannel: TextChannel | null }> => {
  let guildOwner = null;

  if (guild.members.me?.permissions.has('ViewAuditLog', true)) {
    const auditLog = await guild
      .fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 })
      .catch(() => null);

    guildOwner = auditLog?.entries.first()?.executor ?? null;
  }

  const guildChannel = guild.channels.cache
    .filter(
      (c) => c.type === ChannelType.GuildText && c.permissionsFor(guild.id)?.has('SendMessages'),
    )
    .first() as unknown as TextChannel;

  return { guildOwner, guildChannel };
};


const buildLogsEmbed = (
  guild: Guild,
  guildOwnerName: string,
  totalGuilds: number,
  { title, color }: { title: string; color: ColorResolvable },
) =>
  new EmbedBuilder()
    .setColor(color)
    .setThumbnail(guild.iconURL())
    .setTitle(title)
    .setDescription(
      stripIndents`
    - Name: ${guild.name}
    - ID: ${guild.id}
    - Owner: ${guild.ownerId} (${guildOwnerName})
    - Member Count: ${guild.memberCount}
  `,
    )
    .setFooter({ text: `Total Guilds: ${totalGuilds}` });


export const logGuildJoin = async (guild: Guild) => {
  const count = (await guild.client.cluster.fetchClientValues('guilds.cache.size')) as number[];
  const guildOwner = await guild.client.users.fetch(guild.ownerId);
  const totalGuilds = count.reduce((p, n) => p + n, 0);

  await guild.client.cluster.broadcastEval(
    async (client, ctx) => {
      const inviteLogChannel = client.channels.cache.get(ctx.inviteLogs);
      if (!inviteLogChannel?.isSendable()) return;
      await inviteLogChannel.send({ embeds: [ctx.logsEmbed] });
    },
    {
      context: {
        inviteLogs: Constants.Channels.inviteLogs,
        logsEmbed: buildLogsEmbed(guild, guildOwner.username, totalGuilds, {
          color: Constants.Colors.interchat,
          title: '✨ Invited to New Server',
        }).toJSON(),
      },
    },
  );
};

export const logGuildLeave = async (guild: Guild) => {
  const count = (await guild.client.cluster.fetchClientValues('guilds.cache.size')) as number[];
  const guildOwner = await guild.client.users.fetch(guild.ownerId);
  const totalGuilds = count.reduce((p, n) => p + n, 0);

  // send message to support server notifying of leave
  // we cant access any variables/functions or anything inside the broadcastEval callback so we pass it in as context
  await guild.client.cluster.broadcastEval(
    async (client, ctx) => {
      const inviteLogChannel = client.channels.cache.get(ctx.inviteLogs);
      if (!inviteLogChannel?.isSendable()) return;

      await inviteLogChannel.send({ embeds: [ctx.logsEmbed] });

    },
    {
      context: {
        inviteLogs: Constants.Channels.inviteLogs,
        logsEmbed: buildLogsEmbed(guild, guildOwner.username, totalGuilds, {
          color: Constants.Colors.interchat,
          title: '👢 Kicked from server',
        }).toJSON(),
      },
    },
  );
};
