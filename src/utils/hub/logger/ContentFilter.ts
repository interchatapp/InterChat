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
import Logger from '#src/utils/Logger.js';
import Constants from '#utils/Constants.js';
import { stripIndents } from 'common-tags';
import { EmbedBuilder, type Message } from 'discord.js';
import { sendLog } from './Default.js';

/**
 * Log a blocked message to the appropriate log channel
 * @param message The message that was blocked
 * @param category The category of prohibited content
 * @param client The Discord client
 */
export const logBlockedMessage = async (message: Message<true>): Promise<void> => {
  try {
    const client = message.client;
    // Create an embed for the log
    const embed = new EmbedBuilder()
      .setTitle(`${getEmoji('exclamation', client)} Content Filter: Message Blocked`)
      .setColor(Constants.Colors.error)
      .setDescription(
        stripIndents`
        A message was blocked by the content filter during a call.
        
        ${getEmoji('dot', client)} **User:** ${message.author.username} (${message.author.id})
        ${getEmoji('dot', client)} **Server:** ${message.guild?.name || 'Unknown'} (${message.guildId})
        ${getEmoji('dot', client)} **Channel:** <#${message.channelId}>
        ${getEmoji('dot', client)} **Time:** <t:${Math.floor(Date.now() / 1000)}:F>
        `,
      )
      .setFooter({
        text: `Message ID: ${message.id}`,
        iconURL: message.author.displayAvatarURL(),
      })
      .setTimestamp();

    // Send to system log channel if configured
    // Note: In a real implementation, you might want to send this to a specific moderation channel
    const systemLogChannelId = process.env.SYSTEM_LOG_CHANNEL;
    if (systemLogChannelId) {
      await sendLog(client.cluster, systemLogChannelId, embed);
    }
  }
  catch (error) {
    Logger.error('Failed to log blocked message:', error);
  }
};
