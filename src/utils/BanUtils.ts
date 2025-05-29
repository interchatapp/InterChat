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

import Context from '#src/core/CommandContext/Context.js';
import ServerBanManager from '#src/managers/ServerBanManager.js';
import BanManager from '#src/managers/UserBanManager.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { handleError } from '#src/utils/Utils.js';
import Logger from '#utils/Logger.js';
import type { User } from 'discord.js';

export const handleBan = async (
  interaction: Context,
  targetId: string,
  target: User | null,
  reason: string,
  type: 'PERMANENT' | 'TEMPORARY' = 'PERMANENT',
  duration?: number,
) => {
  if (targetId === interaction.user.id) {
    await interaction.reply({
      content: `Let's not go there. ${getEmoji('bruhcat', interaction.client)}`,
      flags: ['Ephemeral'],
    });
    return;
  }

  const banManager = new BanManager();

  // Check if user is already banned
  const banCheck = await banManager.isUserBanned(targetId);
  if (banCheck.isBanned) {
    await interaction.reply({
      content: `${getEmoji('slash', interaction.client)} This user is already banned (Ban ID: ${banCheck.ban?.id}).`,
      flags: ['Ephemeral'],
    });
    return;
  }

  try {
    const ban = await banManager.createBan({
      userId: targetId,
      moderatorId: interaction.user.id,
      reason,
      type,
      duration,
    });

    const targetUsername = target?.username || targetId;
    const durationText =
      type === 'TEMPORARY' && duration ? ` for ${formatDuration(duration)}` : ' permanently';

    Logger.info(
      `User ${targetUsername} (${targetId}) banned${durationText} by ${interaction.user.username} (Ban ID: ${ban.id})`,
    );

    await interaction.reply(
      `${getEmoji('tick', interaction.client)} Successfully banned \`${targetUsername}\`${durationText}. They can no longer use the bot. (Ban ID: \`${ban.id}\`)`,
    );
  }
  catch (error) {
    handleError(error, {
      repliable: interaction instanceof Context ? interaction.interaction : interaction,
      comment: 'Failed to ban user. **Possible reasons:** User has not used the bot before',
    });
  }
};

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days !== 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
}

export const handleServerBan = async (
  interaction: Context,
  targetServerId: string,
  targetServerName: string | null,
  reason: string,
  type: 'PERMANENT' | 'TEMPORARY' = 'PERMANENT',
  duration?: number,
) => {
  const serverBanManager = new ServerBanManager();

  // Check if server is already banned
  const banCheck = await serverBanManager.isServerBanned(targetServerId);
  if (banCheck.isBanned) {
    await interaction.reply({
      content: `${getEmoji('slash', interaction.client)} This server is already banned (Ban ID: ${banCheck.ban?.id}).`,
      flags: ['Ephemeral'],
    });
    return;
  }

  try {
    const ban = await serverBanManager.createServerBan({
      serverId: targetServerId,
      moderatorId: interaction.user.id,
      reason,
      type,
      duration,
    });

    const durationText =
      type === 'TEMPORARY' && duration ? ` for ${formatDuration(duration)}` : ' permanently';

    Logger.info(
      `Server ${targetServerName} (${targetServerId}) banned${durationText} by ${interaction.user.username} (Ban ID: ${ban.id})`,
    );

    await interaction.reply(
      `${getEmoji('tick', interaction.client)} Successfully banned server \`${targetServerName}\`${durationText}. They can no longer use the bot. (Ban ID: \`${ban.id}\`)`,
    );
  }
  catch (error) {
    Logger.error('Error creating server ban:', error);
    await interaction.reply({
      content: `${getEmoji('x_icon', interaction.client)} Failed to ban server: ${error instanceof Error ? error.message : 'Unknown error'}`,
      flags: ['Ephemeral'],
    });
  }
};
