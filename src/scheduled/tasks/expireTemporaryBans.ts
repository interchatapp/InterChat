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

import BanManager from '#src/managers/UserBanManager.js';
import Logger from '#src/utils/Logger.js';

/**
 * Scheduled task to expire temporary bans that have reached their expiration time
 * This task runs every 5 minutes to ensure timely ban expiration
 */
export default async (): Promise<void> => {
  try {
    const banManager = new BanManager();
    const expiredCount = await banManager.expireTemporaryBans();

    if (expiredCount > 0) {
      Logger.info(`Expired ${expiredCount} temporary bans`);
    }
  }
  catch (error) {
    Logger.error('Error expiring temporary bans:', error);
  }
};
