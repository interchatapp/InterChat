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
import Constants from '#utils/Constants.js';
import db from '#utils/Db.js';
import Logger from '#utils/Logger.js';
import { REST, Routes } from 'discord.js';

export class DonationManager {
  private scheduler: Scheduler;
  private readonly userDbManager = new UserDbService();
  private readonly rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN as string);

  constructor(scheduler = new Scheduler()) {
    this.scheduler = scheduler;

    this.scheduler.addRecurringTask('cleanupExpiredDonations', 60 * 60 * 1_000, async () => {
      const expiredUsers = await db.user.findMany({
        where: {
          donationTier: { not: null },
          donationExpiresAt: { lt: new Date() },
        },
      });

      for (const user of expiredUsers) {
        await this.userDbManager.updateUser(user.id, {
          donationTier: null,
          donationExpiresAt: null,
        });
        Logger.info(`[donation] Expired donation tier for user ${user.id}`);
      }
    });
  }

  async addDonorRole(userId: string): Promise<void> {
    if (!Constants.DonorRoleId) {
      Logger.warn('[donation] DONOR_ROLE_ID not configured');
      return;
    }

    await this.modifyUserRole('add', { userId, roleId: Constants.DonorRoleId });
  }

  async removeDonorRole(userId: string): Promise<void> {
    if (!Constants.DonorRoleId) return;
    await this.modifyUserRole('remove', { userId, roleId: Constants.DonorRoleId });
  }

  private async modifyUserRole(
    type: 'add' | 'remove',
    { userId, roleId }: { userId: string; roleId: string },
  ): Promise<void> {
    try {
      const userInGuild = (await this.rest
        .get(Routes.guildMember(Constants.SupportServerId, userId))
        .catch(() => null)) as { roles: string[] } | null;

      if (type === 'remove' && !userInGuild?.roles.includes(roleId)) return;

      const method = type === 'add' ? 'put' : 'delete';
      await this.rest[method](Routes.guildMemberRole(Constants.SupportServerId, userId, roleId));
    }
    catch (error) {
      Logger.error(`[donation] Failed to ${type} role ${roleId} for user ${userId}`, error);
    }
  }

  async getUserTotalDonated(userId: string): Promise<number> {
    const user = await this.userDbManager.getUser(userId);
    return user?.totalDonated ?? 0;
  }

  async getUserDonationCount(userId: string): Promise<number> {
    const user = await this.userDbManager.getUser(userId);
    return user?.donationCount ?? 0;
  }

  async isUserDonor(userId: string): Promise<boolean> {
    const user = await this.userDbManager.getUser(userId);
    return user?.isDonor ?? false;
  }
}
