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

import { CacheManager } from '#src/managers/CacheManager.js';
import HubManager from '#src/managers/HubManager.js';
import { HubSettingsBits } from '#src/modules/BitFields.js';
import { deleteConnections } from '#src/utils/ConnectedListUtils.js';
import Constants, { RedisKeys } from '#src/utils/Constants.js';
import db from '#src/utils/Db.js';
import getRedis from '#src/utils/Redis.js';
import type { ConvertDatesToString } from '#types/Utils.d.ts';
import type { Hub, PrismaClient, Role } from '#src/generated/prisma/client/client.js';

export interface HubCreationData {
  name: string;
  description: string;
  iconUrl?: string;
  bannerUrl?: string;
  ownerId: string;
}

/**
 * Cache TTL constants in seconds
 */
export const HUB_CACHE_TTL = {
  /** TTL for individual hub data (10 minutes) */
  HUB: 10 * 60,
  /** TTL for hub lists like owned hubs, moderated hubs (5 minutes) */
  HUB_LISTS: 5 * 60,
  /** TTL for popular hubs (30 minutes) */
  POPULAR_HUBS: 30 * 60,
};

export class HubService {
  private readonly db: PrismaClient;
  private readonly cacheManager: CacheManager;
  public readonly hubKey = RedisKeys.Hub;

  constructor(_db: PrismaClient = db) {
    this.db = _db;
    this.cacheManager = new CacheManager(getRedis(), {
      prefix: this.hubKey,
      expirationMs: HUB_CACHE_TTL.HUB * 1000,
    });
  }

  static parseHubStringToObject(hub: string): Hub {
    const parsedHub = JSON.parse(hub) as ConvertDatesToString<Hub>;

    return {
      ...parsedHub,
      lastActive: new Date(parsedHub.lastActive),
      createdAt: new Date(parsedHub.createdAt),
      updatedAt: new Date(parsedHub.updatedAt),
    };
  }

  private createHubManager(hub: Hub | string): HubManager {
    if (typeof hub === 'string') {
      return new HubManager(HubService.parseHubStringToObject(hub), { hubService: this });
    }
    return new HubManager(hub, { hubService: this });
  }

  /**
   * Updates the cache for a hub
   * @param hub The hub to update in cache
   */
  async updateHubCache(hub: Hub): Promise<void> {
    // Update cache by ID
    await this.cacheManager.set(hub.id, hub, HUB_CACHE_TTL.HUB);

    // Update cache by name
    const nameKey = `name:${hub.name}`;
    await this.cacheManager.set(nameKey, hub, HUB_CACHE_TTL.HUB);

    // Invalidate user-related caches that might contain this hub
    await this.cacheManager.delete(`owned:${hub.ownerId}`);

    // Invalidate moderated hubs cache for this user
    // We can't invalidate all moderated hubs caches, so we focus on the owner
    await this.cacheManager.delete(`moderated:${hub.ownerId}`);

    // Invalidate popular hubs cache - we use a simple key for this
    await this.cacheManager.delete('popular:5'); // Default limit

    // Invalidate search cache for this hub name
    await this.cacheManager.delete(`search:${hub.name}`);

    // Invalidate existing hubs cache for this owner
    await this.cacheManager.delete(`existing:${hub.ownerId}:${hub.name}`);
  }

  /**
   * Helper method to parse dates in hub objects from cache
   * @param hub The hub object from cache with string dates
   * @returns The hub object with proper Date objects
   */
  private parseHubDates(hub: ConvertDatesToString<Hub>): Hub {
    return {
      ...hub,
      lastActive: new Date(hub.lastActive),
      createdAt: new Date(hub.createdAt),
      updatedAt: new Date(hub.updatedAt),
    };
  }

  /**
   * Invalidates all caches related to a hub
   * @param hubId The ID of the hub to invalidate caches for
   */
  async invalidateHubCaches(hubId: string): Promise<void> {
    const hub = await this.fetchHubFromDb(hubId);
    if (hub) {
      await this.cacheManager.delete(hub.id);
      await this.cacheManager.delete(`name:${hub.name}`);
      await this.cacheManager.delete(`owned:${hub.ownerId}`);
      await this.cacheManager.delete(`moderated:${hub.ownerId}`);
      await this.cacheManager.delete('popular');
    }
  }

  /**
   * Fetches a hub directly from the database without using cache
   * @param hubId The ID of the hub to fetch
   * @returns The hub or null if not found
   */
  private async fetchHubFromDb(hubId: string): Promise<Hub | null> {
    return await this.db.hub.findUnique({ where: { id: hubId } });
  }

  /**
   * Fetches a hub by ID or name
   * @param whereInput The ID or name of the hub to fetch
   * @returns A HubManager instance or null if not found
   */
  async fetchHub(whereInput: string | { id?: string; name?: string }): Promise<HubManager | null> {
    const where: { id?: string; name?: string } =
      typeof whereInput === 'string' ? { id: whereInput } : whereInput;

    if (!where.id && !where.name) return null;

    // Check cache if we have an ID
    if (where.id) {
      const cachedHub = await this.cacheManager.get<ConvertDatesToString<Hub>>(where.id);

      if (cachedHub) {
        // Convert string dates back to Date objects
        const hub = this.parseHubDates(cachedHub);
        return this.createHubManager(hub);
      }

      // Not in cache, fetch from database
      const hub = await this.db.hub.findUnique({ where: { id: where.id } });
      if (hub) {
        // Cache the result
        await this.cacheManager.set(where.id, hub);
        return this.createHubManager(hub);
      }

      return null;
    }

    // Check cache if we have a name
    if (where.name) {
      const nameKey = `name:${where.name}`;
      const cachedHub = await this.cacheManager.get<ConvertDatesToString<Hub>>(nameKey);

      if (cachedHub) {
        // Convert string dates back to Date objects
        const hub = this.parseHubDates(cachedHub);
        return this.createHubManager(hub);
      }

      // Not in cache, fetch from database
      const hub = await this.db.hub.findFirst({ where: { name: where.name } });
      if (hub) {
        // Cache the result
        await this.cacheManager.set(nameKey, hub);
        // Also cache by ID for future lookups
        await this.cacheManager.set(hub.id, hub);
        return this.createHubManager(hub);
      }

      return null;
    }

    return null;
  }

  /**
   * Creates a new hub
   * @param data The data for the new hub
   * @returns A HubManager instance for the new hub
   */
  async createHub(data: HubCreationData): Promise<HubManager> {
    const hub = await this.db.hub.create({
      data: {
        ...data,
        private: true,
        iconUrl: data.iconUrl || Constants.Links.EasterAvatar,
        bannerUrl: data.bannerUrl || null,
        settings:
          HubSettingsBits.SpamFilter | HubSettingsBits.Reactions | HubSettingsBits.BlockNSFW,
      },
    });

    // Cache the new hub
    await this.cacheManager.set(hub.id, hub);
    await this.cacheManager.set(`name:${hub.name}`, hub);

    // Invalidate user-related caches
    await this.cacheManager.delete(`owned:${hub.ownerId}`);

    return this.createHubManager(hub);
  }

  /**
   * Deletes a hub and all related data
   * @param hubId The ID of the hub to delete
   */
  async deleteHub(hubId: string): Promise<void> {
    const hub = await this.fetchHub(hubId);
    if (!hub) return;

    // Store owner ID for cache invalidation
    const ownerId = hub.data.ownerId;
    const hubName = hub.data.name;

    // delete all relations first
    (await hub.fetchLogConfig()).deleteAll();
    await hub.moderators.removeAll();
    await deleteConnections({ hubId });

    await this.db.$transaction([
      this.db.hubInvite.deleteMany({ where: { hubId } }),
      this.db.blockWord.deleteMany({ where: { hubId } }),
      this.db.hubRulesAcceptance.deleteMany({ where: { hubId } }),
      // TODO: Redo the infraction manager, rename the key to be hub:<hubId>:infractions
      // and also make it possible to delete from cache too.
      this.db.infraction.deleteMany({ where: { hubId } }),
    ]);

    // delete the hub
    await this.db.hub.delete({ where: { id: hubId } });

    // Invalidate caches
    await this.cacheManager.delete(hubId);
    await this.cacheManager.delete(`name:${hubName}`);
    await this.cacheManager.delete(`owned:${ownerId}`);
    await this.cacheManager.delete(`moderated:${ownerId}`);
    await this.cacheManager.delete('popular');
  }

  /**
   * Gets all hubs owned by a user
   * @param userId The ID of the user
   * @returns An array of HubManager instances
   */
  async getOwnedHubs(userId: string): Promise<HubManager[]> {
    const cacheKey = `owned:${userId}`;

    // Try to get from cache first
    const cachedHubs = await this.cacheManager.get<ConvertDatesToString<Hub>[]>(cacheKey);

    if (cachedHubs) {
      // Convert string dates back to Date objects for each hub
      return cachedHubs.map((cachedHub) => {
        const hub = this.parseHubDates(cachedHub);
        return this.createHubManager(hub);
      });
    }

    // Not in cache, fetch from database
    const hubs = await this.db.hub.findMany({ where: { ownerId: userId } });

    // Cache the result with TTL
    if (hubs.length > 0) {
      await this.cacheManager.set(cacheKey, hubs, HUB_CACHE_TTL.HUB_LISTS);
    }

    return hubs.map((hub) => this.createHubManager(hub));
  }

  /**
   * Finds hubs by name with optional filters
   * @param name The name to search for
   * @param opts Optional filters and limits
   * @returns An array of HubManager instances
   */
  async findHubsByName(
    name: string,
    opts?: { insensitive?: boolean; ownerId?: string; take?: number },
  ): Promise<HubManager[]> {
    // Generate a cache key based on the search parameters
    const cacheKey = `search:${name}:${opts?.insensitive ? 'i' : 's'}:${opts?.ownerId || 'all'}:${opts?.take || 'all'}`;

    // Try to get from cache first
    const cachedHubs = await this.cacheManager.get<ConvertDatesToString<Hub>[]>(cacheKey);

    if (cachedHubs) {
      // Convert string dates back to Date objects for each hub
      return cachedHubs.map((cachedHub) => {
        const hub = this.parseHubDates(cachedHub);
        return this.createHubManager(hub);
      });
    }

    // Not in cache, fetch from database
    const hubs = await this.db.hub.findMany({
      where: {
        name: {
          mode: opts?.insensitive ? 'insensitive' : 'default',
          equals: name,
        },
        ownerId: opts?.ownerId,
      },
      take: opts?.take,
    });

    // Cache the result with TTL
    if (hubs.length > 0) {
      await this.cacheManager.set(cacheKey, hubs, HUB_CACHE_TTL.HUB_LISTS);
    }

    return hubs.map((hub) => this.createHubManager(hub));
  }

  /**
   * Gets hubs that match either the owner ID or the hub name
   * @param ownerId The owner ID to match
   * @param hubName The hub name to match
   * @returns An array of HubManager instances
   */
  async getExistingHubs(ownerId: string, hubName: string): Promise<HubManager[]> {
    const cacheKey = `existing:${ownerId}:${hubName}`;

    // Try to get from cache first
    const cachedHubs = await this.cacheManager.get<ConvertDatesToString<Hub>[]>(cacheKey);

    if (cachedHubs) {
      // Convert string dates back to Date objects for each hub
      return cachedHubs.map((cachedHub) => {
        const hub = this.parseHubDates(cachedHub);
        return this.createHubManager(hub);
      });
    }

    // Not in cache, fetch from database
    const hubs = await this.db.hub.findMany({
      where: { OR: [{ ownerId }, { name: hubName }] },
    });

    // Cache the result with TTL
    if (hubs.length > 0) {
      await this.cacheManager.set(cacheKey, hubs, HUB_CACHE_TTL.HUB_LISTS);
    }

    return hubs.map((hub) => this.createHubManager(hub));
  }

  /**
   * Fetches hubs that a user moderates or owns
   * @param userId The ID of the user
   * @param roles Optional filter for specific moderator roles
   * @returns An array of HubManager instances
   */
  async fetchModeratedHubs(userId: string, roles?: Role[]): Promise<HubManager[]> {
    const cacheKey = `moderated:${userId}:${roles?.join(',') || 'all'}`;

    // Try to get from cache first
    const cachedResult = await this.cacheManager.get<{
      ownedHubs: ConvertDatesToString<Hub>[];
      modPositions: { role: Role; hub: ConvertDatesToString<Hub> }[];
    }>(cacheKey);

    if (cachedResult) {
      const ownedHubs = cachedResult.ownedHubs.map((cachedHub) => {
        const hub = this.parseHubDates(cachedHub);
        return this.createHubManager(hub);
      });

      const modHubs = cachedResult.modPositions
        .filter((mod) => !roles?.length || roles.includes(mod.role))
        .map((mod) => {
          const hub = this.parseHubDates(mod.hub);
          return this.createHubManager(hub);
        });

      return [...ownedHubs, ...modHubs];
    }

    // Not in cache, fetch from database
    const user = await this.db.user.findFirst({
      where: { id: userId },
      include: { modPositions: { include: { hub: true } }, ownedHubs: true },
    });

    if (!user) return [];
    if (user.modPositions.length === 0 && user.ownedHubs.length === 0) return [];

    // Cache the result with TTL
    await this.cacheManager.set(
      cacheKey,
      {
        ownedHubs: user.ownedHubs,
        modPositions: user.modPositions,
      },
      HUB_CACHE_TTL.HUB_LISTS,
    );

    const ownedHubs = user.ownedHubs.map((hub) => this.createHubManager(hub));
    const modHubs = user.modPositions
      .filter((mod) => !roles?.length || roles.includes(mod.role))
      .map((mod) => this.createHubManager(mod.hub));

    return [...ownedHubs, ...modHubs];
  }

  /**
   * Fetches the most popular hubs based on member count and activity
   * @param limit Maximum number of hubs to return (default: 5)
   * @returns Array of HubManager instances for the most popular hubs
   */
  async getPopularHubs(
    limit: number = 5,
  ): Promise<Array<{ totalConnections: number; hub: HubManager }>> {
    const cacheKey = `popular:${limit}`;

    // Try to get from cache first
    const cachedResult =
      await this.cacheManager.get<
        Array<{
          hub: ConvertDatesToString<Hub>;
          totalConnections: number;
        }>
      >(cacheKey);

    if (cachedResult) {
      return cachedResult.map(({ hub: cachedHub, totalConnections }) => {
        const hub = this.parseHubDates(cachedHub);
        return {
          totalConnections,
          hub: this.createHubManager(hub),
        };
      });
    }

    // Not in cache, fetch from database
    const hubs = await this.db.hub.findMany({
      where: { private: false, locked: false },
      orderBy: [{ lastActive: 'desc' }, { connections: { _count: 'desc' } }],
      include: { _count: { select: { connections: true } } },
      take: limit,
    });

    const result = hubs.map((hub) => ({
      totalConnections: hub._count.connections,
      hub,
    }));

    // Cache the result with TTL
    if (result.length > 0) {
      await this.cacheManager.set(cacheKey, result, HUB_CACHE_TTL.POPULAR_HUBS);
    }

    return result.map(({ hub, totalConnections }) => ({
      totalConnections,
      hub: this.createHubManager(hub),
    }));
  }
}
