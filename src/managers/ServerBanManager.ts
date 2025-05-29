import type { BanType, ServerBan } from '#src/generated/prisma/client/client.js';
import { CacheManager } from '#src/managers/CacheManager.js';
import db from '#src/utils/Db.js';
import Logger from '#src/utils/Logger.js';
import { getRedis } from '#src/utils/Redis.js';

export interface CreateServerBanOptions {
  serverId: string;
  moderatorId: string;
  reason: string;
  type: BanType;
  duration?: number; // Duration in milliseconds for temporary bans
}

export interface ServerBanCheckResult {
  isBanned: boolean;
  ban?: ServerBan;
}

/**
 * Manager for handling server-level bans across InterChat
 * Uses the database ServerBan model for persistence
 */
export default class ServerBanManager {
  private readonly cacheManager: CacheManager;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.cacheManager = new CacheManager(getRedis(), {
      prefix: 'server_ban',
      expirationMs: ServerBanManager.CACHE_TTL_MS,
    });
  }

  /**
   * Create a new server ban
   */
  async createServerBan(options: CreateServerBanOptions): Promise<ServerBan> {
    const { serverId, moderatorId, reason, type, duration } = options;

    // Calculate expiration date for temporary bans
    const expiresAt = type === 'TEMPORARY' && duration ? new Date(Date.now() + duration) : null;

    // Check if server already has an active ban
    const existingBan = await this.isServerBanned(serverId);
    if (existingBan.isBanned) {
      throw new Error(`Server ${serverId} is already banned (Ban ID: ${existingBan.ban?.id})`);
    }

    // Create the server ban record in the database
    const serverBan = await db.serverBan.create({
      data: {
        serverId,
        moderatorId,
        reason,
        type,
        duration,
        expiresAt,
        status: 'ACTIVE',
      },
      include: {
        server: true,
        moderator: true,
      },
    });

    // Invalidate cache
    await this.invalidateServerCache(serverId);

    Logger.info(`Server ${serverId} banned by ${moderatorId} (Ban ID: ${serverBan.id})`);

    return serverBan;
  }

  /**
   * Check if a server is currently banned
   */
  async isServerBanned(serverId: string): Promise<ServerBanCheckResult> {
    const cacheKey = `server:${serverId}`;

    // Try to get from cache first
    const cachedResult = await this.cacheManager.get<ServerBanCheckResult>(cacheKey);

    if (cachedResult) {
      // Convert cached dates back to Date objects if there's a ban
      const ban = cachedResult.ban
        ? {
          ...cachedResult.ban,
          createdAt: new Date(cachedResult.ban.createdAt),
          updatedAt: new Date(cachedResult.ban.updatedAt),
          expiresAt: cachedResult.ban.expiresAt ? new Date(cachedResult.ban.expiresAt) : null,
        }
        : null;

      return { ...cachedResult, ban } as ServerBanCheckResult;
    }

    // Get active ban from database
    const ban = await db.serverBan.findFirst({
      where: {
        serverId,
        status: 'ACTIVE',
        OR: [
          { expiresAt: null }, // Permanent bans
          { expiresAt: { gt: new Date() } }, // Non-expired temporary bans
        ],
      },
      include: {
        server: true,
        moderator: true,
      },
    });

    const result: ServerBanCheckResult = {
      isBanned: !!ban,
      ban: ban || undefined,
    };

    // Cache the result
    await this.cacheManager.set(cacheKey, result);

    return result;
  }

  /**
   * Invalidate cache for a server
   */
  private async invalidateServerCache(serverId: string): Promise<void> {
    const cacheKey = `server:${serverId}`;
    await this.cacheManager.delete(cacheKey);
  }

  /**
   * Get all active server bans (for autocomplete and listing)
   */
  async getActiveBans(): Promise<ServerBan[]> {
    return db.serverBan.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { expiresAt: null }, // Permanent bans
          { expiresAt: { gt: new Date() } }, // Non-expired temporary bans
        ],
      },
      include: {
        server: true,
        moderator: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100, // Limit for performance
    });
  }

  /**
   * Get a server ban by its ID
   */
  async getBanById(banId: string): Promise<ServerBan | null> {
    return db.serverBan.findUnique({
      where: { id: banId },
      include: {
        server: true,
        moderator: true,
      },
    });
  }

  /**
   * Revoke a server ban by ban ID
   */
  async revokeBan(banId: string, moderatorId: string): Promise<ServerBan> {
    const ban = await this.getBanById(banId);
    if (!ban) {
      throw new Error(`Server ban with ID ${banId} not found`);
    }

    if (ban.status !== 'ACTIVE') {
      throw new Error(`Server ban ${banId} is not active (status: ${ban.status})`);
    }

    // Update ban status in database
    const updatedBan = await db.serverBan.update({
      where: { id: banId },
      data: {
        status: 'REVOKED',
        updatedAt: new Date(),
      },
      include: {
        server: true,
        moderator: true,
      },
    });

    // Invalidate cache
    await this.invalidateServerCache(ban.serverId);

    Logger.info(
      `Server ban revoked: ${banId} for server ${ban.serverId} by moderator ${moderatorId}`,
    );

    return updatedBan;
  }

  /**
   * Expire temporary server bans that have reached their expiration time
   * This method should be called by a scheduled task
   */
  async expireTemporaryServerBans(): Promise<number> {
    // Find all expired temporary bans
    const expiredBans = await db.serverBan.findMany({
      where: {
        status: 'ACTIVE',
        type: 'TEMPORARY',
        expiresAt: {
          lte: new Date(),
        },
      },
    });

    if (expiredBans.length === 0) {
      return 0;
    }

    // Update all expired bans to EXPIRED status
    await db.serverBan.updateMany({
      where: {
        id: {
          in: expiredBans.map((ban) => ban.id),
        },
      },
      data: {
        status: 'EXPIRED',
        updatedAt: new Date(),
      },
    });

    // Invalidate cache for all affected servers
    for (const ban of expiredBans) {
      await this.invalidateServerCache(ban.serverId);
    }

    Logger.info(`Expired ${expiredBans.length} temporary server bans`);

    return expiredBans.length;
  }
}
