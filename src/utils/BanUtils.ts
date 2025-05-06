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

import type Context from '#src/core/CommandContext/Context.js';
import UserDbService from '#src/services/UserDbService.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Logger from '#utils/Logger.js';
import type { User } from 'discord.js';

export const handleBan = async (
  interaction: Context,
  targetId: string,
  target: User | null,
  reason: string,
) => {
  if (targetId === interaction.user.id) {
    await interaction.reply({
      content: `Let's not go there. ${getEmoji('bruhcat', interaction.client)}`,
      flags: ['Ephemeral'],
    });
    return;
  }

  const userService = new UserDbService();
  const dbUser = await userService.getUser(targetId);

  if (dbUser?.banReason) {
    await interaction.reply({
      content: `${getEmoji('slash', interaction.client)} This user is already banned.`,
      flags: ['Ephemeral'],
    });
    return;
  }

  const targetUsername = target?.username;
  await userService.ban(targetId, reason, targetUsername);

  Logger.info(`User ${targetUsername} (${targetId}) banned by ${interaction.user.username}.`);

  await interaction.reply(
    `${getEmoji('tick', interaction.client)} Successfully banned \`${targetUsername}\`. They can no longer use the bot.`,
  );
};
