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
import { EmbedBuilder, type Guild } from 'discord.js';
import HubLogManager from '#src/managers/HubLogManager.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { getHubConnections } from '#utils/ConnectedListUtils.js';
import Constants from '#utils/Constants.js';
import { sendLog } from './Default.js';

export const logJoinToHub = async (
  hubId: string,
  server: Guild,
  opt?: { totalConnections: number; hubName: string },
) => {
  const logManager = await HubLogManager.create(hubId);
  if (!logManager.config.joinLeaves) return;

  const dotBlueEmoji = getEmoji('dotBlue', server.client);
  const owner = await server.fetchOwner();
  const embed = new EmbedBuilder()
    .setTitle('New Server Joined')
    .setDescription(
      stripIndents`
        ${dotBlueEmoji} **Server:** ${server.name} (${server.id})
        ${dotBlueEmoji} **Owner:** ${owner.user.tag} (${server.ownerId})
        ${dotBlueEmoji} **Member Count:** ${server.memberCount}
      `,
    )
    .setColor(Constants.Colors.interchatBlue)
    .setThumbnail(server.iconURL())
    .setFooter({
      text: `We have ${opt?.totalConnections} server(s) connected to ${opt?.hubName} now!`,
    });

  await sendLog(server.client.cluster, logManager.config.joinLeaves.channelId, embed);
};

export const logGuildLeaveToHub = async (hubId: string, server: Guild) => {
  const logManager = await HubLogManager.create(hubId);
  if (!logManager.config.joinLeaves) return;

  const owner = await server.client.users.fetch(server.ownerId).catch(() => null);
  const totalConnections = (await getHubConnections(hubId))?.reduce(
    (total, c) => total + (c.connected ? 1 : 0),
    0,
  );

  const dotRedEmoji = getEmoji('dotRed', server.client);

  const embed = new EmbedBuilder()
    .setTitle('Server Left')
    .setDescription(
      stripIndents`
        ${dotRedEmoji} **Server:** ${server.name} (${server.id})
        ${dotRedEmoji} **Owner:** ${owner?.username} (${server.ownerId})
        ${dotRedEmoji} **Member Count:** ${server.memberCount}
      `,
    )
    .setColor('Red')
    .setThumbnail(server.iconURL())
    .setFooter({
      text: `We now have ${totalConnections} server(s) connected to the hub now!`,
    });

  await sendLog(server.client.cluster, logManager.config.joinLeaves.channelId, embed);
};
