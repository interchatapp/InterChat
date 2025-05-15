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

import messageService from '#src/services/MessageService.js';
import Logger from '#src/utils/Logger.js';

/**
 * Scheduled task to clean up old messages from the database.
 * Deletes messages older than 24 hours.
 */
export default async () => {
  try {
    Logger.info('Starting cleanup of old messages...');

    // Delete messages older than 24 hours
    const deletedCount = await messageService.deleteOldMessages(24);

    Logger.info(`Successfully deleted ${deletedCount} old messages from the database.`);
  }
  catch (error) {
    Logger.error('Error cleaning up old messages:', error);
  }
};
