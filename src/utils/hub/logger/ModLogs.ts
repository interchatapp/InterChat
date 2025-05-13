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
import { type Client, EmbedBuilder, type Snowflake, User, codeBlock } from 'discord.js';
import BlacklistManager from '#src/managers/BlacklistManager.js';
import type HubLogManager from '#src/managers/HubLogManager.js';
import type HubManager from '#src/managers/HubManager.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Constants from '#utils/Constants.js';
import { sendLog } from './Default.js';
import type { Message as MessageDB } from '#src/generated/prisma/client/client.js';

const getUnblacklistEmbed = (
  type: 'User' | 'Server',
  client: Client,
  opts: {
    name: string;
    id: Snowflake;
    mod: User | { id: Snowflake; username: string };
    hubName: string;
    reason?: string;
    originalReason?: string;
  },
) =>
  new EmbedBuilder()
    .setAuthor({ name: `${type} ${opts.name} unblacklisted` })
    .setDescription(
      stripIndents`
      ${getEmoji('dot', client)} **${type}:** ${opts.name} (${opts.id})
      ${getEmoji('dot', client)} **Moderator:** ${opts.mod.username} (${opts.mod.id})
      ${getEmoji('dot', client)} **Hub:** ${opts.hubName}
    `,
    )
    .addFields(
      {
        name: 'Reason for Unblacklist',
        value: opts.reason ?? 'No reason provided.',
        inline: true,
      },
      {
        name: 'Blacklisted For',
        value: opts.originalReason ?? 'Unknown',
        inline: true,
      },
    )
    .setColor(Constants.Colors.primary)
    .setFooter({
      text: `Unblacklisted by: ${opts.mod.username}`,
      iconURL: opts.mod instanceof User ? opts.mod.displayAvatarURL() : undefined,
    });

type UnblacklistOpts = {
  id: string;
  mod: User | { id: Snowflake; username: string };
  reason?: string;
};

export const logServerUnblacklist = async (
  client: Client,
  hub: HubManager,
  opts: UnblacklistOpts,
) => {
  const blacklistManager = new BlacklistManager('server', opts.id);
  const blacklist = await blacklistManager.fetchBlacklist(hub.id);

  const logConfig = await hub.fetchLogConfig();
  const modLogsChannelId = logConfig.config.modLogsChannelId;
  if (!blacklist?.serverName || !modLogsChannelId) return;

  const embed = getUnblacklistEmbed('Server', client, {
    id: opts.id,
    name: blacklist.serverName,
    mod: opts.mod,
    hubName: hub.data.name,
    reason: opts.reason,
    originalReason: blacklist.reason,
  });

  await sendLog(client.cluster, modLogsChannelId, embed);
};

export const logUserUnblacklist = async (
  client: Client,
  hub: HubManager,
  opts: UnblacklistOpts,
) => {
  const blacklistManager = new BlacklistManager('user', opts.id);
  const blacklist = await blacklistManager.fetchBlacklist(hub.id);

  const logConfig = await hub.fetchLogConfig();
  const modLogsChannelId = logConfig.config.modLogsChannelId;
  if (!blacklist || !modLogsChannelId) return;

  const user = await client.users.fetch(opts.id).catch(() => null);
  const name = `${user?.username}`;

  const embed = getUnblacklistEmbed('User', client, {
    name,
    id: opts.id,
    mod: opts.mod,
    reason: opts.reason,
    hubName: hub.data.name,
    originalReason: blacklist.reason,
  });

  await sendLog(client.cluster, modLogsChannelId, embed);
};

export const logMsgDelete = async (
  client: Client,
  originalMsg: MessageDB,
  logConfig: HubLogManager,
  opts: { hubName: string; modName: string },
) => {
  const modLogsChannelId = logConfig.config.modLogsChannelId;
  if (!modLogsChannelId) return;

  const { authorId, guildId, content } = originalMsg;
  const user = await client.users.fetch(authorId).catch(() => null);
  const server = await client.fetchGuild(guildId).catch(() => null);

  const embed = new EmbedBuilder()
    .setDescription(
      stripIndents`
      ### ${getEmoji('delete_icon', client)} Message Deleted
      **Message Content:**
      ${codeBlock(content.length > 0 ? content : 'No content provided.')}
    `,
    )
    .setColor(Constants.Colors.invisible)
    .setImage(originalMsg.imageUrl || null)
    .addFields([
      {
        name: `${getEmoji('person_icon', client)} User`,
        value: `${user?.username} (\`${authorId}\`)`,
      },
      {
        name: `${getEmoji('rules_icon', client)} Server`,
        value: `${server?.name} (\`${guildId}\`)`,
      },
      { name: `${getEmoji('globe_icon', client)} Hub`, value: opts.hubName },
    ])
    .setFooter({ text: `Deleted by: ${opts.modName}` });

  await sendLog(client.cluster, modLogsChannelId, embed);
};
