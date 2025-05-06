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

import type { BlockWord, Hub } from '#src/generated/prisma/client/client.js';
import HubConnectionsManager from '#src/managers/HubConnectionsManager.js';
import HubLogManager from '#src/managers/HubLogManager.js';
import HubModeratorManager from '#src/managers/HubModeratorManager.js';
import HubSettingsManager from '#src/managers/HubSettingsManager.js';
import { HubService } from '#src/services/HubService.js';
import db from '#src/utils/Db.js';

export default class HubManager {
  private readonly components: {
    hubService: HubService;
    moderators: HubModeratorManager;
    settings: HubSettingsManager;
    connections: HubConnectionsManager;
    logs: HubLogManager | null;
  };
  private hub: Hub;

  constructor(
    hub: Hub,
    config: Partial<{
      hubService: HubService;
      modManager: HubModeratorManager;
    }> = {},
  ) {
    this.hub = hub;
    this.components = {
      hubService: config.hubService ?? new HubService(),
      moderators: config.modManager ?? new HubModeratorManager(this),
      settings: new HubSettingsManager(this),
      connections: new HubConnectionsManager(this),
      logs: null,
    };
  }

  // Public accessors
  public get id(): string {
    return this.hub.id;
  }

  public get data(): Hub {
    return this.hub;
  }

  public get settings(): HubSettingsManager {
    return this.components.settings;
  }

  public get moderators(): HubModeratorManager {
    return this.components.moderators;
  }

  public get connections(): HubConnectionsManager {
    return this.components.connections;
  }

  // Data operations
  public async update(
    data: Partial<
      Pick<
        Hub,
        | 'description'
        | 'iconUrl'
        | 'bannerUrl'
        | 'welcomeMessage'
        | 'private'
        | 'locked'
        | 'appealCooldownHours'
        | 'settings'
        | 'ownerId'
      >
    >,
  ): Promise<void> {
    this.hub = await db.hub.update({
      where: { id: this.hub.id },
      data,
    });

    // Update the cache with the new hub data
    await this.components.hubService.updateHubCache(this.hub);
  }

  public async delete(): Promise<void> {
    await this.components.hubService.deleteHub(this.hub.id);
  }

  public async createInvite(expires: Date) {
    return await db.hubInvite.create({
      data: {
        hub: { connect: { id: this.hub.id } },
        expires,
      },
    });
  }

  public async fetchAntiSwearRules(): Promise<BlockWord[]> {
    return await db.blockWord.findMany({ where: { hubId: this.hub.id } });
  }
  public async fetchAntiSwearRule(ruleId: string): Promise<BlockWord | null> {
    return await db.blockWord.findUnique({ where: { id: ruleId } });
  }

  public async fetchInvites() {
    return await db.hubInvite.findMany({
      where: { hubId: this.hub.id },
    });
  }

  public async fetchLogConfig() {
    if (!this.components.logs) {
      this.components.logs = await HubLogManager.create(this.hub.id);
    }
    return this.components.logs;
  }

  // Authorization methods
  public isOwner(userId: string): boolean {
    return this.data.ownerId === userId;
  }

  public async isManager(userId: string): Promise<boolean> {
    return await this.components.moderators.checkStatus(userId, ['MANAGER']);
  }

  public async isMod(userId: string): Promise<boolean> {
    return await this.components.moderators.checkStatus(userId);
  }

  public async updateRules(rules: string[]): Promise<void> {
    this.hub = await db.hub.update({
      where: { id: this.hub.id },
      data: { rules },
    });

    // Update the cache with the new hub data
    await this.components.hubService.updateHubCache(this.hub);
  }

  public getRules(): string[] {
    return this.hub.rules;
  }
}
