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

import BaseEventListener from '#src/core/BaseEventListener.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Constants from '#utils/Constants.js';
import {
  getGuildOwnerOrFirstChannel as getGuildOwnerAndFirstChannel,
  logGuildJoin,
} from '#utils/GuildUtils.js';
import Logger from '#utils/Logger.js';
import {
  type Guild,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
} from 'discord.js';

export default class Ready extends BaseEventListener<'guildCreate'> {
  readonly name = 'guildCreate';
  public async execute(guild: Guild) {
    Logger.info(`Joined ${guild.name} (${guild.id})`);

    // log that bot joined a guild to goal channel in support server
    await logGuildJoin(guild);

    const { guildChannel } = await getGuildOwnerAndFirstChannel(guild);

    // Create the new interactive welcome message
    const welcomeContainer = await Ready.createWelcomeMessage(guild);

    // Send to first available channel
    guildChannel
      ?.send({ components: [welcomeContainer], flags: [MessageFlags.IsComponentsV2] })
      .catch(() => null);

    // store guild in database
    await db.serverData.upsert({
      where: { id: guild.id },
      create: { id: guild.id, name: guild.name, iconUrl: guild.iconURL() },
      update: { name: guild.name, iconUrl: guild.iconURL() },
    });
  }

  static async createWelcomeMessage(guild: Guild): Promise<ContainerBuilder> {
    const ui = new UIComponents(guild.client);
    const container = new ContainerBuilder();

    // Main welcome header
    container.addTextDisplayComponents(
      ui.createHeader(
        'Welcome to InterChat!',
        `Thanks for adding InterChat to **${guild.name}**! Let's get you started with cross-server chatting in just a few steps.`,
      ),
    );

    // Section 1: Setup Calls
    const callsSection = new SectionBuilder();
    callsSection
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '### 📞 Setup Calls\nTry our beta call feature for instant server-to-server connections!',
        ),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(new CustomID().setIdentifier('welcome', 'calls').toString())
          .setLabel('Setup Calls')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(getEmoji('call_icon', guild.client)),
      );
    container.addSectionComponents(callsSection);

    // Section 2: Setup Hubs
    const hubsSection = new SectionBuilder();
    hubsSection
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '### 🏠 Setup Shared Chat\nConnect to hubs for persistent cross-server chatting!',
        ),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(new CustomID().setIdentifier('welcome', 'setup').toString())
          .setLabel('Setup Hubs')
          .setStyle(ButtonStyle.Primary)
          .setEmoji(getEmoji('house_icon', guild.client)),
      );
    container.addSectionComponents(hubsSection);

    // Section 3: Visit Dashboard
    const dashboardSection = new SectionBuilder();
    dashboardSection
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '### 🛠️ Visit Dashboard\nManage your hubs, connections, and settings with our web interface!',
        ),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setLabel('Open Dashboard')
          .setURL(`${Constants.Links.Website}/dashboard`)
          .setStyle(ButtonStyle.Link)
          .setEmoji(getEmoji('wand_icon', guild.client)),
      );
    container.addSectionComponents(dashboardSection);

    // Section 4: Browse Hubs
    const browseSection = new SectionBuilder();
    browseSection
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '### 🔍 Find Shared Chatrooms\nDiscover active communities and find the perfect hub for your interests!',
        ),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setLabel('Browse All Hubs')
          .setURL(`${Constants.Links.Website}/hubs`)
          .setStyle(ButtonStyle.Link)
          .setEmoji(getEmoji('globe_icon', guild.client)),
      );
    container.addSectionComponents(browseSection);

    return container;
  }
}
