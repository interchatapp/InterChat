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

import type { Hub, PrismaClient, Role } from '@prisma/client';
import type { Redis } from 'ioredis';
import HubManager from '#src/managers/HubManager.js';
import { HubSettingsBits } from '#src/modules/BitFields.js';
import type { ConvertDatesToString } from '#types/Utils.d.ts';
import { deleteConnections } from '#src/utils/ConnectedListUtils.js';
import Constants, { RedisKeys } from '#src/utils/Constants.js';
import db from '#src/utils/Db.js';
import getRedis from '#src/utils/Redis.js';

export interface HubCreationData {
  name: string;
  description: string;
  iconUrl?: string;
  bannerUrl?: string;
  ownerId: string;
}

export class HubService {
  private readonly db: PrismaClient;
  private readonly cache: Redis;
  public readonly hubKey = `${RedisKeys.Hub}:`;

  constructor(_db: PrismaClient = db, cache = getRedis()) {
    this.db = _db;
    this.cache = cache;
  }

  static parseHubStringToObject(hub: string): Hub {
    const parsedHub = JSON.parse(hub) as ConvertDatesToString<Hub>;

    return {
      ...parsedHub,
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

  async fetchHub(whereInput: string | { id?: string; name?: string }): Promise<HubManager | null> {
    const where: { id?: string; name?: string } =
      typeof whereInput === 'string' ? { id: whereInput } : whereInput;

    if (!where.id && !where.name) {
      return null;
    }

    // Check cache if we have an ID
    if (where.id) {
      const fromCache = await this.cache.get(`${this.hubKey}${where.id}`);
      if (fromCache) {
        return this.createHubManager(fromCache);
      }
    }

    const hub = await this.db.hub.findFirst({ where });

    // Cache result if we found something
    if (hub) {
      await this.cache.set(`${this.hubKey}${hub.id}`, JSON.stringify(hub));
      return this.createHubManager(hub);
    }

    return null;
  }

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

    return this.createHubManager(hub);
  }

  async deleteHub(hubId: string): Promise<void> {
    const hub = await this.fetchHub(hubId);
    if (!hub) return;

    // delete all relations first
    (await hub.fetchLogConfig()).deleteAll();
    await hub.moderators.removeAll();
    await deleteConnections({ hubId });

    await this.db.$transaction([
      this.db.hubInvite.deleteMany({ where: { hubId } }),
      this.db.blockWord.deleteMany({ where: { hubId } }),
      // TODO: Redo the infraction manager, rename the key to be hub:<hubId>:infractions
      // and also make it possible to delete from cache too.
      this.db.infraction.deleteMany({ where: { hubId } }),
    ]);

    // delete the hub
    await this.db.hub.delete({ where: { id: hubId } });
  }

  async getOwnedHubs(userId: string) {
    const hubs = await this.db.hub.findMany({ where: { ownerId: userId } });
    return hubs.map((hub) => this.createHubManager(hub));
  }

  async findHubsByName(
    name: string,
    opts?: { insensitive?: boolean; ownerId?: string; take?: number },
  ): Promise<HubManager[]> {
    const hubs = await this.db.hub.findMany({
      where: {
        name: {
          mode: opts?.insensitive ? 'insensitive' : 'default',
          contains: name,
        },
        ownerId: opts?.ownerId,
      },
      take: opts?.take,
    });

    return hubs.map((hub) => this.createHubManager(hub));
  }

  async getExistingHubs(ownerId: string, hubName: string) {
    const hubs = await this.db.hub.findMany({
      where: { OR: [{ ownerId }, { name: hubName }] },
    });

    return hubs.map((hub) => this.createHubManager(hub));
  }

  async fetchModeratedHubs(userId: string, roles?: Role[]) {
    const user = await this.db.userData.findFirst({
      where: { id: userId },
      include: { modPositions: { include: { hub: true } }, ownedHubs: true },
    });

    if (!user) return [];
    if (user.modPositions.length === 0 && user.ownedHubs.length === 0) return [];

    const ownedHubs = user.ownedHubs.map((hub) => this.createHubManager(hub));
    const modHubs = user.modPositions
      .filter((mod) => !roles?.length || roles.includes(mod.role))
      .map((mod) => this.createHubManager(mod.hub));

    return [...ownedHubs, ...modHubs];
  }
}
