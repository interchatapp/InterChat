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
import { getEmoji } from '#src/utils/EmojiUtils.js';
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

const buildGoalEmbed = (guildName: string, iconURL: string | null, color: ColorResolvable) =>
  new EmbedBuilder().setAuthor({ name: guildName, iconURL: iconURL ?? undefined }).setColor(color);

const buildLogsEmbed = (
  guild: Guild,
  guildOwnerName: string,
  { title, color }: { title: string; color: ColorResolvable },
) =>
  new EmbedBuilder()
    .setColor(color)
    .setThumbnail(guild.iconURL())
    .setTitle(title)
    .setDescription(stripIndents`
    - Name: ${guild.name}
    - ID: ${guild.id}
    - Owner: ${guild.ownerId} (${guildOwnerName})
    - Member Count: ${guild.memberCount}
  `);

/**
 * @param channelId must be a channel ID in the support server
 */
export const logGuildJoin = async (guild: Guild, channelId: string) => {
  const guildOwner = await guild.client.users.fetch(guild.ownerId);

  await guild.client.cluster.broadcastEval(
    async (client, ctx) => {
      const goalChannel = client.channels.cache.get(ctx.goalChannel);
      const inviteLogChannel = client.channels.cache.get(ctx.inviteLogs);

      if (!goalChannel?.isSendable() || !inviteLogChannel?.isSendable()) {
        return;
      }

      const count = (await client.cluster.fetchClientValues('guilds.cache.size')) as number[];
      const guildCount = count.reduce((p, n) => p + n, 0);

      await inviteLogChannel.send({ embeds: [ctx.logsEmbed] });

      const goal = 100 * Math.floor(guildCount / 100) + 100;
      const message =
        goal === guildCount
          ? `**I've reached **${goal}** servers!** 🎉`
          : `**${goal - guildCount}** servers to go!`;
      const content = `${ctx.guildName} added me, I'm in **${guildCount}** servers. ${message}`;

      // send message to support server notifying of new guild
      await goalChannel.send({ content, embeds: [ctx.goalEmbed] });
    },
    {
      context: {
        guildName: guild.name,
        goalChannel: channelId,
        inviteLogs: Constants.Channels.inviteLogs,
        flushedEmoji: getEmoji('chipi_flushed', guild.client),
        goalEmbed: buildGoalEmbed(
          guild.name,
          guild.iconURL(),
          Constants.Colors.interchatBlue,
        ).toJSON(),
        logsEmbed: buildLogsEmbed(guild, guildOwner.username, {
          color: Constants.Colors.interchatBlue,
          title: '✨ Invited to New Server',
        }).toJSON(),
      },
    },
  );
};

export const logGuildLeave = async (guild: Guild, channelId: string) => {
  const count = (await guild.client.cluster.fetchClientValues('guilds.cache.size')) as number[];
  const guildOwner = await guild.client.users.fetch(guild.ownerId);

  // send message to support server notifying of leave
  // we cant access any variables/functions or anything inside the broadcastEval callback so we pass it in as context
  await guild.client.cluster.broadcastEval(
    async (client, ctx) => {
      const goalChannel = await client.channels.fetch(ctx.goalChannel).catch(() => null);
      const inviteLogChannel = client.channels.cache.get(ctx.inviteLogs);

      if (!goalChannel?.isSendable() || !inviteLogChannel?.isSendable()) {
        return;
      }

      await inviteLogChannel.send({ embeds: [ctx.logsEmbed] });
      await goalChannel.send({
        content: `👢 ${ctx.guildName} kicked me. I'm back to **${ctx.guildCount}** servers ${ctx.cryEmoji}`,
        embeds: [ctx.goalEmbed],
      });
    },
    {
      context: {
        guildName: guild.name,
        goalChannel: channelId,
        inviteLogs: Constants.Channels.inviteLogs,
        guildCount: count.reduce((p, n) => p + n, 0),
        cryEmoji: getEmoji('chipi_cry', guild.client),
        goalEmbed: buildGoalEmbed(guild.name, guild.iconURL(), 'Red'),
        logsEmbed: buildLogsEmbed(guild, guildOwner.username, {
          color: Constants.Colors.interchatBlue,
          title: '👢 Kicked from server',
        }).toJSON(),
      },
    },
  );
};
