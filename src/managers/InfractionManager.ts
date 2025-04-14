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

import type {
  Infraction,
  InfractionStatus,
  InfractionType,
  Prisma,
} from '#src/generated/prisma/client/client.js';
import { HubService } from '#src/services/HubService.js';
import db from '#src/utils/Db.js';
import { logServerUnblacklist, logUserUnblacklist } from '#src/utils/hub/logger/ModLogs.js';
import type { Client, Snowflake, User } from 'discord.js';

/**
 * Interface for infraction creation options
 */
interface InfractionCreateOptions {
  serverName?: string;
  hubId: string;
  reason: string;
  moderatorId: Snowflake;
  expiresAt: Date | null;
}

/**
 * Interface for infraction filter options
 */
interface InfractionFilter {
  type: InfractionType;
  hubId: string;
  status?: InfractionStatus;
}

/**
 * Interface for hub infractions query options
 */
interface HubInfractionsOptions {
  type?: InfractionType;
  count?: number;
}

/**
 * Manages infractions (warnings, bans, etc.) for users and servers
 */
export default class InfractionManager {
  public readonly targetId: Snowflake;
  public readonly targetType: 'user' | 'server';

  /**
   * Creates a new InfractionManager instance
   * @param targetType - Type of target ('user' or 'server')
   * @param targetId - Discord ID of the target
   */
  constructor(targetType: 'user' | 'server', targetId: Snowflake) {
    this.targetId = targetId;
    this.targetType = targetType;
  }

  // -------------------------------------------------------------------------
  // CRUD Operations
  // -------------------------------------------------------------------------

  /**
   * Creates a new infraction for the target
   * @param type - Type of infraction
   * @param options - Infraction details
   * @returns The created infraction
   */
  public async addInfraction(
    type: InfractionType,
    options: InfractionCreateOptions,
  ): Promise<Infraction> {
    return await db.infraction.create({
      data: {
        ...options,
        userId: this.targetType === 'user' ? this.targetId : undefined,
        serverId: this.targetType === 'server' ? this.targetId : undefined,
        serverName: options.serverName,
        type,
        notified: false, // Default value for new infractions
      },
    });
  }

  /**
   * Updates an existing infraction
   * @param filter - Filter to find the infraction to update
   * @param data - Data to update the infraction with
   * @returns The updated infraction or null if not found
   */
  public async updateInfraction(
    filter: InfractionFilter,
    data: Prisma.InfractionUpdateInput,
  ): Promise<Infraction | null> {
    const infraction = await this.fetchInfraction(filter.type, filter.hubId, filter.status);
    if (!infraction) return null;

    return await db.infraction.update({
      where: { id: infraction.id },
      data,
    });
  }

  /**
   * Permanently removes an infraction
   * @param type - Type of infraction to remove
   * @param hubId - ID of the hub the infraction belongs to
   * @returns The deleted infraction or null if not found
   */
  public async removeInfraction(type: InfractionType, hubId: string): Promise<Infraction | null> {
    const infraction = await this.fetchInfraction(type, hubId);
    if (!infraction) return null;

    return await db.infraction.delete({ where: { id: infraction.id } });
  }

  /**
   * Changes an active infraction's status to revoked or expired
   * @param type - Type of infraction to revoke
   * @param hubId - ID of the hub the infraction belongs to
   * @param status - New status for the infraction (default: 'REVOKED')
   * @returns The updated infraction or null if not found
   */
  public async revokeInfraction(
    type: InfractionType,
    hubId: string,
    status: Exclude<InfractionStatus, 'ACTIVE'> = 'REVOKED',
  ): Promise<Infraction | null> {
    return await this.updateInfraction({ type, hubId, status: 'ACTIVE' }, { status });
  }

  // -------------------------------------------------------------------------
  // Query Operations
  // -------------------------------------------------------------------------

  /**
   * Fetches all infractions for the target in a specific hub
   * @param hubId - ID of the hub to fetch infractions for
   * @param options - Optional filtering options
   * @returns Array of infractions
   */
  public async getHubInfractions(
    hubId: string,
    options?: HubInfractionsOptions,
  ): Promise<Infraction[]> {
    let infractions = await this.queryEntityInfractions(hubId);

    if (options?.type) {
      infractions = infractions.filter((i) => i.type === options.type);
    }

    if (options?.count) {
      infractions = infractions.slice(0, options.count);
    }

    return infractions;
  }

  /**
   * Fetches a specific infraction by type and hub
   * @param type - Type of infraction to fetch
   * @param hubId - ID of the hub the infraction belongs to
   * @param status - Optional status filter
   * @returns The infraction or null if not found
   */
  public async fetchInfraction(
    type: InfractionType,
    hubId: string,
    status?: InfractionStatus,
  ): Promise<Infraction | null> {
    const infractions = await this.getHubInfractions(hubId, { type });
    const infraction = infractions.find(
      (i) => (status ? i.status === status : true) && i.type === type,
    );

    return infraction ?? null;
  }

  /**
   * Fetches unnotified infractions of a specific type for a hub
   * @param type - Type of infractions to fetch
   * @param hubId - ID of the hub to fetch infractions for
   * @returns Array of unnotified infractions
   */
  public async getUnnotifiedInfractions(
    type: InfractionType,
    hubId: string,
  ): Promise<Infraction[]> {
    return await db.infraction.findMany({
      where: {
        type,
        hubId,
        status: 'ACTIVE',
        notified: false,
        ...(this.targetType === 'user' ? { userId: this.targetId } : { serverId: this.targetId }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // -------------------------------------------------------------------------
  // Utility Methods
  // -------------------------------------------------------------------------

  /**
   * Marks multiple infractions as notified
   * @param infractionIds - Array of infraction IDs to mark as notified
   */
  public async markInfractionsAsNotified(infractionIds: string[]): Promise<void> {
    if (infractionIds.length === 0) return;

    await db.infraction.updateMany({
      where: { id: { in: infractionIds } },
      data: { notified: true },
    });
  }

  /**
   * Filters out expired infractions from an array
   * @param infractions - Array of infractions to filter
   * @returns Array of valid (non-expired) infractions
   */
  public filterValidInfractions(infractions: Infraction[]): Infraction[] {
    if (!infractions.length) return [];

    return infractions.filter(({ expiresAt }) => !expiresAt || expiresAt > new Date());
  }

  /**
   * Checks if an infraction is expired
   * @param infraction - Infraction to check
   * @returns True if the infraction is expired or null, false otherwise
   */
  public isExpiredInfraction(infraction: Infraction | null): boolean {
    if (!infraction) return true;
    if (!infraction.expiresAt) return false; // No expiration date means not expired

    return infraction.expiresAt <= new Date();
  }

  /**
   * Logs an unblacklist action to the appropriate mod log channel
   * @param client - Discord client instance
   * @param hubId - ID of the hub to log in
   * @param id - ID of the unblacklisted entity
   * @param options - Options containing moderator and reason
   */
  public async logUnblacklist(
    client: Client,
    hubId: string,
    id: string,
    options: { mod: User; reason?: string },
  ): Promise<void> {
    const hub = await new HubService().fetchHub(hubId);
    if (!hub) return;

    const logData = {
      id,
      mod: options.mod,
      reason: options.reason,
    };

    if (this.targetType === 'user') {
      await logUserUnblacklist(client, hub, logData);
    }
    else {
      await logServerUnblacklist(client, hub, logData);
    }
  }

  // -------------------------------------------------------------------------
  // Private Helper Methods
  // -------------------------------------------------------------------------

  /**
   * Queries infractions for the current entity (user or server)
   * @param hubId - ID of the hub to query infractions for
   * @returns Array of infractions with their latest appeal
   * @private
   */
  private async queryEntityInfractions(hubId: string): Promise<Infraction[]> {
    const whereClause =
      this.targetType === 'user'
        ? { userId: this.targetId, hubId }
        : { serverId: this.targetId, hubId };

    return await db.infraction.findMany({
      where: whereClause,
      include: { appeals: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
