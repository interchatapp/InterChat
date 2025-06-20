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
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type Client,
  ContainerBuilder,
  SectionBuilder,
  SeparatorSpacingSize,
  type Snowflake,
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
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('connection', 'toggle')
            .setArgs(channelId)
            .setArgs(userId)
            .toString(),
        )
        .setLabel(networkData.connected ? 'Pause' : 'Enable')
        .setStyle(networkData.connected ? ButtonStyle.Danger : ButtonStyle.Success)
        .setEmoji(getEmoji(networkData.connected ? 'disconnect' : 'connect', client)),
    );

  // Add compact mode section
  const compactSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${t('connection.embed.fields.compact', locale)}:** ${yesOrNoEmoji(networkData.compact, '✅', '❌')}`,
      ),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('connection', 'toggle_compact')
            .setArgs(channelId)
            .setArgs(userId)
            .toString(),
        )
        .setLabel('Toggle Compact')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(getEmoji('chat_icon', client)),
    );

  // Add embed color section
  const embedColorSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${t('connection.embed.fields.emColor', locale)}:** ${networkData.embedColor || '❌'}`,
      ),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('connection', 'set_color')
            .setArgs(channelId)
            .setArgs(userId)
            .toString(),
        )
        .setLabel('Set Color')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🎨'),
    );

  // Add hub info section
  const hubSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${getEmoji('globe_icon', client)} ${t('connection.embed.fields.hub', locale)}:** ${networkData.hub?.name}`,
      ),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('connection', 'change_hub')
            .setArgs(channelId)
            .setArgs(userId)
            .toString(),
        )
        .setLabel('Change Hub')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(getEmoji('globe_icon', client)),
    );

  // Add channel info section
  const channelSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${getEmoji('hash_icon', client)} ${t('connection.embed.fields.channel', locale)}:** <#${channelId}>`,
      ),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('connection', 'change_channel_btn')
            .setArgs(channelId)
            .setArgs(userId)
            .toString(),
        )
        .setLabel('Change Channel')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(getEmoji('hash_icon', client)),
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
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('connection', 'set_invite')
            .setArgs(channelId)
            .setArgs(userId)
            .toString(),
        )
        .setLabel('Set Invite')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(getEmoji('plus_icon', client)),
    );

  // Add all sections to container
  container
    .addSectionComponents(statusSection, compactSection, embedColorSection)
    .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
    .addSectionComponents(hubSection, channelSection, inviteSection)
    .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small));

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
    .addActionRowComponents((row) => row.addComponents(channelSelectMenu));

  // Add footer
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      '*Use the select menus below to modify connection settings*',
    ),
  );

  return container;
};
