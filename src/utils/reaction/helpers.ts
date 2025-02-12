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

import BlacklistManager from '#src/managers/BlacklistManager.js';

import { isBlacklisted } from '#utils/moderation/blacklistUtils.js';

/**
 * Checks if a user or server is blacklisted in a given hub.
 * @param hubId - The ID of the hub to check in.
 * @param guildId - The ID of the guild to check for blacklist.
 * @param userId - The ID of the user to check for blacklist.
 * @returns An object containing whether the user and/or server is blacklisted in the hub.
 */
export const checkBlacklists = async (
  hubId: string,
  guildId: string | null,
  userId: string | null,
) => {
  const userBlacklistManager = userId ? new BlacklistManager('user', userId) : undefined;
  const guildBlacklistManager = guildId ? new BlacklistManager('server', guildId) : undefined;

  const userBlacklist = await userBlacklistManager?.fetchBlacklist(hubId);
  const serverBlacklist = await guildBlacklistManager?.fetchBlacklist(hubId);

  return {
    userBlacklisted: isBlacklisted(userBlacklist ?? null),
    serverBlacklisted: isBlacklisted(serverBlacklist ?? null),
  };
};
