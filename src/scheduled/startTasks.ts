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

import type { ClusterManager } from 'discord-hybrid-sharding';
import deleteExpiredInvites from '#src/scheduled/tasks/deleteExpiredInvites.js';
// import pauseIdleConnections from '#src/scheduled/tasks/pauseIdleConnections.js';
import storeMsgTimestamps from '#src/scheduled/tasks/storeMsgTimestamps.js';
import syncBotlistStats from '#src/scheduled/tasks/syncBotlistStats.js';
import cleanupOldMessages from '#src/scheduled/tasks/cleanupOldMessages.js';
import cleanupExpiredCalls from '#src/scheduled/tasks/cleanupExpiredCalls.js';
import expireTemporaryBans from '#src/scheduled/tasks/expireTemporaryBans.js';
import removeExpiredSupporterBadges from '#src/scheduled/tasks/removeExpiredSupporterBadges.js';
import Scheduler from '#src/services/SchedulerService.js';
import Constants from '#src/utils/Constants.js';
import Logger from '#src/utils/Logger.js';

export default function startTasks(clusterManager: ClusterManager) {
  // pauseIdleConnections().catch(Logger.error);
  deleteExpiredInvites().catch(Logger.error);

  const scheduler = new Scheduler();

  // store network message timestamps to Connection every minute
  scheduler.addRecurringTask('storeMsgTimestamps', 10 * 60 * 1000, storeMsgTimestamps);

  // Expire temporary bans every 5 minutes
  scheduler.addRecurringTask('expireTemporaryBans', 5 * 60 * 1000, expireTemporaryBans);

  // Clean up expired call data every 15 minutes
  scheduler.addRecurringTask('cleanupExpiredCalls', 15 * 60 * 1000, () => {
    cleanupExpiredCalls().catch(Logger.error);
  });

  // Run cleanup tasks every hour
  scheduler.addRecurringTask('cleanupTasks', 60 * 60 * 1000, () => {
    deleteExpiredInvites().catch(Logger.error);
    // pauseIdleConnections().catch(Logger.error);
  });

  cleanupOldMessages().catch(Logger.error);

  // Clean up old messages every 12 hours
  scheduler.addRecurringTask('cleanupOldMessages', 12 * 60 * 60 * 1000, () => {
    cleanupOldMessages().catch(Logger.error);
  });

  // Remove expired supporter badges every hour
  scheduler.addRecurringTask('removeExpiredSupporterBadges', 60 * 60 * 1000, () => {
    removeExpiredSupporterBadges().catch(Logger.error);
  });

  // production only tasks
  if (!Constants.isDevBuild) {
    scheduler.addRecurringTask('syncBotlistStats', 10 * 60 * 10_000, async () => {
      const servers = await clusterManager.fetchClientValues('guilds.cache.size');
      const serverCount = servers.reduce((p: number, n: number) => p + n, 0);
      syncBotlistStats(serverCount);
    });
  }
}
