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
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  type Client,
  EmbedBuilder,
  type Snowflake,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  codeBlock,
} from 'discord.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Constants from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import { yesOrNoEmoji } from '#utils/Utils.js';

export const buildEditEmbed = async (
  client: Client<true>,
  channelId: string,
  locale: supportedLocaleCodes = 'en',
) => {
  const networkData = await db.connection.findFirst({
    where: { channelId },
    include: { hub: true },
  });
  const bold = '\x1b[1m';
  const reset = '\x1b[0m';
  const invite = networkData?.invite
    ? `[\`${networkData.invite.replace('https://discord.gg/', '')}\`](${networkData.invite})`
    : 'Not Set.';

  return new EmbedBuilder()
    .setAuthor({ name: t('connection.embed.title', locale) })
    .setDescription(
      codeBlock(
        'ansi',
        stripIndents`
      ${bold}${t('connection.embed.fields.connected', locale)}${reset}: ${yesOrNoEmoji(networkData?.connected, '✅', '❌')}
      ${bold}${t('connection.embed.fields.compact', locale)}${reset}: ${yesOrNoEmoji(networkData?.compact, '✅', '❌')}
      ${bold}${t('connection.embed.fields.emColor', locale)}${reset}: ${networkData?.embedColor ? networkData?.embedColor : '❌'}
    `,
      ),
    )
    .addFields([
      {
        name: `${getEmoji('globe_icon', client)} ${t('connection.embed.fields.hub', locale)}`,
        value: `${networkData?.hub?.name}`,
        inline: true,
      },
      {
        name: `${getEmoji('hash_icon', client)} ${t('connection.embed.fields.channel', locale)}`,
        value: `<#${channelId}>`,
        inline: true,
      },
      {
        name: `${getEmoji('plus_icon', client)} ${t('connection.embed.fields.invite', locale)}`,
        value: invite,
        inline: true,
      },
    ])
    .setColor(Constants.Colors.invisible)
    .setFooter({ text: t('connection.embed.footer', locale) });
};

export const buildEditSelect = (
  client: Client,
  channelId: Snowflake,
  userIdFilter: Snowflake,
  locale: supportedLocaleCodes = 'en',
) =>
  new ActionRowBuilder<StringSelectMenuBuilder>().addComponents([
    new StringSelectMenuBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('connection', 'settings')
          .setArgs(channelId)
          .setArgs(userIdFilter)
          .toString(),
      )
      .setPlaceholder(t('connection.selects.placeholder', locale))
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Compact')
          .setEmoji(getEmoji('chat_icon', client))
          .setDescription('No big embeds, just the essentials.')
          .setValue('compact'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Invite Link')
          .setEmoji(getEmoji('plus_icon', client))
          .setDescription('Let hub members join your server.')
          .setValue('invite'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Embed Color')
          .setEmoji('🎨')
          .setDescription('Set the color of embeds sent by this server.')
          .setValue('embed_color'),
      ),
  ]);

export const buildChannelSelect = (channelId: Snowflake, userIdFilter: Snowflake) =>
  new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('connection', 'change_channel')
          .setArgs(channelId)
          .setArgs(userIdFilter)
          .toString(),
      )
      .setChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread)
      .setPlaceholder('💬 Want to change channels? Click me!'),
  );
