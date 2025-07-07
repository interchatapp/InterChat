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

import Scheduler from '#src/services/SchedulerService.js';
import UserDbService from '#src/services/UserDbService.js';
import db from '#utils/Db.js';
import Logger from '#utils/Logger.js';
import { REST } from 'discord.js';

export class DonationManager {
  private scheduler: Scheduler;
  private readonly userDbManager = new UserDbService();
  private readonly rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN as string);

  constructor(scheduler = new Scheduler()) {
    this.scheduler = scheduler;

    this.scheduler.addRecurringTask('cleanupExpiredDonations', 60 * 60 * 1_000, async () => {
      const expiredUsers = await db.user.findMany({
        where: {
          donationTierId: { not: null },
          donationExpiresAt: { lt: new Date() },
        },
      });

      for (const user of expiredUsers) {
        await this.userDbManager.updateUser(user.id, {
          donationTier: { disconnect: true },
          donationExpiresAt: null,
        });
        Logger.info(`[donation] Expired donation tier for user ${user.id}`);
      }
    });
  }

  async getUserTotalDonated(userId: string): Promise<number> {
    return await this.userDbManager.getTotalDonated(userId);
  }

  async getUserDonationCount(userId: string): Promise<number> {
    const count = await db.donation.count({
      where: { discordUserId: userId, processed: true },
    });

    return count;
  }


}
