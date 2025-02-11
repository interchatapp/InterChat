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

import type { Connection, Prisma } from '@prisma/client';
import type { HexColorString } from 'discord.js';
import { HubService } from '#src/services/HubService.js';
import { cacheHubConnection } from '#src/utils/ConnectedListUtils.js';
import { RedisKeys } from '#src/utils/Constants.js';
import db from '#src/utils/Db.js';
import getRedis from '#src/utils/Redis.js';

export default class ConnectionManager {
  private readonly cache = getRedis();
  private readonly hubService = new HubService();
  private readonly cacheKey: string;

  constructor(private connection: Connection) {
    this.cacheKey = this.buildCacheKey(connection.hubId);
  }

  get id(): string {
    return this.connection.id;
  }

  get hubId(): string {
    return this.connection.hubId;
  }

  get data(): Connection {
    return this.connection;
  }

  get connected(): boolean {
    return this.connection.connected;
  }

  get channelId(): string {
    return this.connection.channelId;
  }

  // Public methods
  async fetchHub() {
    return this.hubService.fetchHub(this.hubId);
  }

  async pause(): Promise<void> {
    await this.updateConnectionIfExists({ connected: false });
  }

  async resume(): Promise<void> {
    await this.updateConnectionIfExists({ connected: true });
  }

  async disconnect(): Promise<void> {
    if (!(await this.connectionExists())) {
      return;
    }

    await db.connection.delete({
      where: { id: this.connection.id },
    });
    await this.clearCache();
  }

  async setInvite(invite: string): Promise<void> {
    await this.updateConnectionIfExists({ invite });
  }

  async setEmbedColor(embedColor: HexColorString): Promise<void> {
    await this.updateConnectionIfExists({ embedColor });
  }

  async setCompactMode(compact: boolean): Promise<void> {
    await this.updateConnectionIfExists({ compact });
  }

  async toggleCompactMode(): Promise<void> {
    await this.updateConnectionIfExists({
      compact: !this.connection.compact,
    });
  }

  // Private helper methods
  private buildCacheKey(hubId: string): string {
    return `${RedisKeys.Hub}:${hubId}:connections`;
  }

  private async connectionExists(): Promise<boolean> {
    return Boolean(await this.cache.hget(this.cacheKey, this.connection.channelId));
  }

  private async updateConnectionIfExists(data: Prisma.ConnectionUpdateInput): Promise<void> {
    if (!(await this.connectionExists())) {
      return;
    }
    await this.updateConnection(data);
  }

  private async updateConnection(data: Prisma.ConnectionUpdateInput): Promise<void> {
    this.connection = await db.connection.update({
      where: { id: this.connection.id },
      data,
    });
    await this.updateCache();
  }

  private async updateCache(): Promise<void> {
    cacheHubConnection(this.connection);
  }

  private async clearCache(): Promise<void> {
    await Promise.all([
      this.cache.hdel(this.cacheKey, this.connection.channelId),
      this.cache.del(`${RedisKeys.connectionHubId}:${this.connection.channelId}`),
    ]);
  }
}
