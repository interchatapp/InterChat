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

import { getEmoji } from '#src/utils/EmojiUtils.js';
import { CustomID } from '#utils/CustomID.js';
import db from '#utils/Db.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import { yesOrNoEmoji } from '#utils/Utils.js';
import {
  ChannelSelectMenuBuilder,
  ChannelType,
  type Client,
  ContainerBuilder,
  SectionBuilder,
  SeparatorSpacingSize,
  type Snowflake,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
} from 'discord.js';

/**
 * Build the connection edit UI using Components v2
 * @param client Discord client
 * @param channelId Channel ID
 * @param userId User ID
 * @param locale Locale
 * @returns ContainerBuilder with the connection edit UI
 */
export const buildConnectionEditUI = async (
  client: Client<true>,
  channelId: string,
  userId: Snowflake,
  locale: supportedLocaleCodes = 'en',
): Promise<ContainerBuilder> => {
  // Fetch connection data
  const networkData = await db.connection.findFirst({
    where: { channelId },
    include: { hub: true },
  });

  if (!networkData) {
    throw new Error(`Connection not found for channel ${channelId}`);
  }

  // Create container
  const container = new ContainerBuilder();

  // Add header
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${getEmoji('globe_icon', client)} ${t('connection.embed.title', locale)}`,
    ),
  );

  // Add connection status section
  const statusSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${t('connection.embed.fields.connected', locale)}:** ${yesOrNoEmoji(networkData.connected, '✅', '❌')}`,
      ),
    );

  // Add compact mode section
  const compactSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${t('connection.embed.fields.compact', locale)}:** ${yesOrNoEmoji(networkData.compact, '✅', '❌')}`,
      ),
    );

  // Add embed color section
  const embedColorSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${t('connection.embed.fields.emColor', locale)}:** ${networkData.embedColor || '❌'}`,
      ),
    );

  // Add hub info section
  const hubSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${getEmoji('globe_icon', client)} ${t('connection.embed.fields.hub', locale)}:** ${networkData.hub?.name}`,
      ),
    );

  // Add channel info section
  const channelSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${getEmoji('hash_icon', client)} ${t('connection.embed.fields.channel', locale)}:** <#${channelId}>`,
      ),
    );

  // Add invite info section
  const invite = networkData.invite
    ? `[\`${networkData.invite.replace('https://discord.gg/', '')}\`](${networkData.invite})`
    : 'Not Set';

  const inviteSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${getEmoji('plus_icon', client)} ${t('connection.embed.fields.invite', locale)}:** ${invite}`,
      ),
    );

  // Add all sections to container
  container
    .addSectionComponents(statusSection, compactSection, embedColorSection)
    .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
    .addSectionComponents(hubSection, channelSection, inviteSection)
    .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small));

  // Add settings select menu
  const settingsSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${getEmoji('wand_icon', client)} Connection Settings`,
      ),
    );

  container.addSectionComponents(settingsSection);

  // Create string select menu for settings
  const settingsSelectMenu = new StringSelectMenuBuilder()
    .setCustomId(
      new CustomID()
        .setIdentifier('connection', 'settings')
        .setArgs(channelId)
        .setArgs(userId)
        .toString(),
    )
    .setPlaceholder('Choose a setting to modify')
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
    );

  // Create channel select menu
  const channelSelectMenu = new ChannelSelectMenuBuilder()
    .setCustomId(
      new CustomID()
        .setIdentifier('connection', 'change_channel')
        .setArgs(channelId)
        .setArgs(userId)
        .toString(),
    )
    .setChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread)
    .setPlaceholder('💬 Want to change channels? Click me!');

  // Add select menus to container
  container
    .addActionRowComponents((row) => row.addComponents(settingsSelectMenu))
    .addActionRowComponents((row) => row.addComponents(channelSelectMenu));

  // Add footer
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      '*Use the select menus below to modify connection settings*',
    ),
  );

  return container;
};
