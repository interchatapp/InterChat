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

import type { Ban, BanType } from '#src/generated/prisma/client/client.js';
import { CacheManager } from '#src/managers/CacheManager.js';
import { ConvertDatesToString } from '#src/types/Utils.js';
import db from '#src/utils/Db.js';
import Logger from '#src/utils/Logger.js';
import { getRedis } from '#src/utils/Redis.js';

export interface CreateBanOptions {
  userId: string;
  moderatorId: string;
  reason: string;
  type: BanType;
  duration?: number; // Duration in milliseconds for temporary bans
}

export interface BanCheckResult {
  isBanned: boolean;
  ban?: Ban;
}

/**
 * Manager for handling global InterChat bans
 */
export class BanManager {
  private static readonly CACHE_PREFIX = 'ban';
  private static readonly CACHE_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes
  private cacheManager: CacheManager;

  constructor() {
    this.cacheManager = new CacheManager(getRedis(), {
      prefix: BanManager.CACHE_PREFIX,
      expirationMs: BanManager.CACHE_EXPIRATION_MS,
    });
  }

  private convertBanDates(ban: ConvertDatesToString<Ban>): Ban {
    return {
      ...ban,
      createdAt: new Date(ban.createdAt),
      updatedAt: new Date(ban.updatedAt),
      expiresAt: ban.expiresAt ? new Date(ban.expiresAt) : null,
    };
  }

  /**
   * Create a new ban
   */
  async createBan(options: CreateBanOptions): Promise<Ban> {
    const { userId, moderatorId, reason, type, duration } = options;

    // Calculate expiration date for temporary bans
    const expiresAt = type === 'TEMPORARY' && duration ? new Date(Date.now() + duration) : null;

    // Check if user already has an active ban
    const existingBan = await this.getActiveBan(userId);
    if (existingBan) {
      throw new Error(`User ${userId} is already banned (Ban ID: ${existingBan.id})`);
    }

    // Create the ban
    const ban = await db.ban.create({
      data: {
        userId,
        moderatorId,
        reason,
        type,
        duration,
        expiresAt,
        status: 'ACTIVE',
      },
      include: {
        user: true,
        moderator: true,
      },
    });

    // Invalidate cache for this user
    await this.invalidateUserCache(userId);

    Logger.info(`Ban created: ${ban.id} for user ${userId} by moderator ${moderatorId}`);

    return ban;
  }

  /**
   * Check if a user is currently banned
   */
  async isUserBanned(userId: string): Promise<BanCheckResult> {
    const cacheKey = `user:${userId}`;

    // Try to get from cache first
    const cachedResult = await this.cacheManager.get<BanCheckResult>(cacheKey);
    if (cachedResult) {
      return {
        ...cachedResult,
        ban: cachedResult.ban ? this.convertBanDates(cachedResult.ban) : undefined,
      };
    }

    // Get active ban from database
    const ban = await this.getActiveBan(userId);
    const result: BanCheckResult = {
      isBanned: !!ban,
      ban: ban || undefined,
    };

    // Cache the result
    await this.cacheManager.set(cacheKey, result);

    return result;
  }

  /**
   * Get the active ban for a user (if any)
   */
  async getActiveBan(userId: string): Promise<Ban | null> {
    const ban = await db.ban.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        OR: [
          { expiresAt: null }, // Permanent bans
          { expiresAt: { gt: new Date() } }, // Non-expired temporary bans
        ],
      },
      include: {
        user: true,
        moderator: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return ban;
  }

  /**
   * Revoke a ban (manually unban a user)
   */
  async revokeBan(banId: string, moderatorId: string): Promise<Ban> {
    const ban = await db.ban.findUnique({
      where: { id: banId },
      include: { user: true },
    });

    if (!ban) {
      throw new Error(`Ban with ID ${banId} not found`);
    }

    if (ban.status !== 'ACTIVE') {
      throw new Error(`Ban ${banId} is not active (status: ${ban.status})`);
    }

    // Update ban status
    const updatedBan = await db.ban.update({
      where: { id: banId },
      data: {
        status: 'REVOKED',
        updatedAt: new Date(),
      },
      include: {
        user: true,
        moderator: true,
      },
    });

    // Invalidate cache for this user
    await this.invalidateUserCache(ban.userId);

    Logger.info(`Ban revoked: ${banId} for user ${ban.userId} by moderator ${moderatorId}`);

    return updatedBan;
  }

  /**
   * Expire temporary bans that have reached their expiration time
   * This method is called by the scheduled task
   */
  async expireTemporaryBans(): Promise<number> {
    const expiredBans = await db.ban.findMany({
      where: {
        status: 'ACTIVE',
        type: 'TEMPORARY',
        expiresAt: {
          lte: new Date(),
        },
      },
      include: { user: true },
    });

    if (expiredBans.length === 0) {
      return 0;
    }

    // Update all expired bans
    await db.ban.updateMany({
      where: {
        id: { in: expiredBans.map((ban) => ban.id) },
      },
      data: {
        status: 'EXPIRED',
        updatedAt: new Date(),
      },
    });

    // Invalidate cache for all affected users
    for (const ban of expiredBans) {
      await this.invalidateUserCache(ban.userId);
    }

    Logger.info(`Expired ${expiredBans.length} temporary bans`);

    return expiredBans.length;
  }

  /**
   * Get all bans for a user (for moderation purposes)
   */
  async getUserBans(userId: string): Promise<Ban[]> {
    return db.ban.findMany({
      where: { userId },
      include: {
        user: true,
        moderator: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Get bans issued by a moderator
   */
  async getBansByModerator(moderatorId: string): Promise<Ban[]> {
    return db.ban.findMany({
      where: { moderatorId },
      include: {
        user: true,
        moderator: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Invalidate cache for a specific user
   */
  private async invalidateUserCache(userId: string): Promise<void> {
    const cacheKey = `user:${userId}`;
    await this.cacheManager.redis.del(`${BanManager.CACHE_PREFIX}:${cacheKey}`);
  }

  /**
   * Get all active bans (for autocomplete and listing)
   */
  async getActiveBans(): Promise<Ban[]> {
    return db.ban.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { expiresAt: null }, // Permanent bans
          { expiresAt: { gt: new Date() } }, // Non-expired temporary bans
        ],
      },
      include: {
        user: true,
        moderator: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100, // Limit for performance
    });
  }

  /**
   * Get a ban by its ID
   */
  async getBanById(banId: string): Promise<Ban | null> {
    return db.ban.findUnique({
      where: { id: banId },
      include: {
        user: true,
        moderator: true,
      },
    });
  }

  /**
   * Get ban statistics
   */
  async getBanStats(): Promise<{
    totalBans: number;
    activeBans: number;
    temporaryBans: number;
    permanentBans: number;
  }> {
    const [totalBans, activeBans, temporaryBans, permanentBans] = await db.$transaction([
      db.ban.count(),
      db.ban.count({ where: { status: 'ACTIVE' } }),
      db.ban.count({ where: { type: 'TEMPORARY' } }),
      db.ban.count({ where: { type: 'PERMANENT' } }),
    ]);

    return {
      totalBans,
      activeBans,
      temporaryBans,
      permanentBans,
    };
  }
}

export default BanManager;
