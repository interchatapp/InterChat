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
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Guild } from 'discord.js';
import BaseEventListener from '#src/core/BaseEventListener.js';
import { donateButton } from '#src/utils/ComponentUtils.js';
import Constants from '#utils/Constants.js';
import {
  getGuildOwnerOrFirstChannel as getGuildOwnerAndFirstChannel,
  logGuildJoin,
} from '#utils/GuildUtils.js';
import Logger from '#utils/Logger.js';
import db from '#src/utils/Db.js';

export default class Ready extends BaseEventListener<'guildCreate'> {
  readonly name = 'guildCreate';
  public async execute(guild: Guild) {
    Logger.info(`Joined ${guild.name} (${guild.id})`);

    // log that bot joined a guild to goal channel in support server
    await logGuildJoin(guild);

    const { guildOwner, guildChannel } = await getGuildOwnerAndFirstChannel(guild);
    const purpleDot = this.getEmoji('dot');

    const embed = new EmbedBuilder()
      .setTitle('👋 Welcome to InterChat!')
      .setThumbnail(guild.client.user.displayAvatarURL())
      .setDescription(
        stripIndents`
        Thanks for adding InterChat! Let's get you started with cross-server chatting in just a few steps:

        ### 🚀 Quick Setup
        1. Run \`/setup\` to connect to your first hub
        2. Choose from our curated list of active hubs
        3. Start chatting across servers instantly!

        ### 💡 Key Features
        ${purpleDot} Real-time cross-server messaging
        ${purpleDot} Custom moderation tools & filters
        ${purpleDot} Message reactions & formatting
        ${purpleDot} Server stats & analytics

        ### 🔗 Useful Links
        ${purpleDot} [Browse All Hubs](${Constants.Links.Website}/hubs)
        ${purpleDot} [Support Server](${Constants.Links.SupportInvite})
        ${purpleDot} [Documentation](${Constants.Links.Website}/docs)
        ${purpleDot} [Vote for Us](${Constants.Links.Vote})

        Need help? Join our [support server](${Constants.Links.SupportInvite}) - we're here to help! 
        If you enjoy InterChat, consider [supporting us](${Constants.Links.Donate}) 💝
        `,
      )
      .setColor(Constants.Colors.interchat)
      .setFooter({
        text: `Sent for server: ${guild.name}`,
        iconURL: guild.iconURL() ?? undefined,
      });

    const buttonsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Setup Guide')
        .setURL(`${Constants.Links.Website}/docs`)
        .setEmoji(this.getEmoji('link_icon'))
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setLabel('Support Server')
        .setURL(Constants.Links.SupportInvite)
        .setEmoji(this.getEmoji('code_icon'))
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setLabel('ToS & Privacy')
        .setURL(`${Constants.Links.Website}/terms`)
        .setEmoji(this.getEmoji('lock_icon'))
        .setStyle(ButtonStyle.Link),
      donateButton,
    );

    const welcomeMsg = { embeds: [embed], components: [buttonsRow] };
    guildOwner?.send(welcomeMsg).catch(() => null);
    guildChannel?.send(welcomeMsg).catch(() => null);

    // store guild in database
    await db.serverData.upsert({
      where: { id: guild.id },
      create: { id: guild.id, name: guild.name },
      update: { name: guild.name },
    });
  }
}
