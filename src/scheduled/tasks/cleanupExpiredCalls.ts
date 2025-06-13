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

import { CallDatabaseService } from '#src/services/CallDatabaseService.js';
import Logger from '#src/utils/Logger.js';
import { handleError } from '#src/utils/Utils.js';

/**
 * Scheduled task to clean up expired call data from the PostgreSQL database.
 *
 * This task implements the following retention policy:
 * - Normal calls: automatically deleted 30 minutes after ending
 * - Reported calls: preserved indefinitely until moderation review is complete
 * - Active calls: never deleted (safety measure)
 *
 * The task runs every 15 minutes to ensure timely cleanup while providing
 * adequate safety margins for data access.
 */
export default async (): Promise<void> => {
  try {
    Logger.info('Starting scheduled cleanup of expired call data...');

    const callDbService = new CallDatabaseService();
    const startTime = Date.now();

    // Perform the cleanup operation
    const result = await callDbService.cleanupExpiredCalls();

    const duration = Date.now() - startTime;

    // Log comprehensive results for monitoring and audit purposes
    Logger.info(
      `Completed call data cleanup in ${duration}ms - ` +
        `Deleted: ${result.deleted} calls, ` +
        `Protected: ${result.protected} calls (reported), ` +
        `Errors: ${result.errors} calls`,
    );

    // Log warning if there were errors during cleanup
    if (result.errors > 0) {
      Logger.warn(
        `Call cleanup completed with ${result.errors} errors. ` +
          'Check previous error logs for details.',
      );
    }

    // Log info if calls were protected from deletion
    if (result.protected > 0) {
      Logger.info(
        `Protected ${result.protected} calls from cleanup due to associated reports. ` +
          'These calls will be preserved until moderation review is complete.',
      );
    }

    // Performance monitoring - warn if cleanup takes too long
    if (duration > 30000) {
      // 30 seconds
      Logger.warn(
        `Call cleanup took ${duration}ms, which is longer than expected. ` +
          'Consider optimizing the cleanup process or database performance.',
      );
    }
  }
  catch (error) {
    handleError(error, { comment: 'Critical error during scheduled call cleanup' });
  }
};
