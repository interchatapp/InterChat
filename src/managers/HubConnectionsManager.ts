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

import type { Connection, Prisma } from '#src/generated/prisma/client/client.js';
import type { Redis } from 'ioredis';
import isEmpty from 'lodash/isEmpty.js';
import ConnectionManager from '#src/managers/ConnectionManager.js';
import type HubManager from '#src/managers/HubManager.js';
import { cacheHubConnection, convertToConnectedList } from '#src/utils/ConnectedListUtils.js';
import { RedisKeys } from '#src/utils/Constants.js';
import db from '#src/utils/Db.js';
import Logger from '#src/utils/Logger.js';
import getRedis from '#src/utils/Redis.js';

interface CacheConfig {
  expirationMs: number;
}

export default class HubConnectionsManager {
  private readonly cacheKey: string;
  private readonly cacheConfig: CacheConfig = {
    expirationMs: 10 * 60 * 1000, // 10 minutes
  };

  constructor(
    private readonly hub: HubManager,
    private readonly redis: Redis = getRedis(),
  ) {
    this.cacheKey = this.buildCacheKey(hub.id);
  }

  async fetch(channelId: string): Promise<ConnectionManager | null>;
  async fetch(): Promise<ConnectionManager[]>;
  async fetch(channelId?: string): Promise<ConnectionManager[] | ConnectionManager | null> {
    if (channelId) {
      const cachedConnection = await this.getCachedConnection(channelId);
      if (cachedConnection) {
        return new ConnectionManager(cachedConnection);
      }

      return this.fetchAndCacheConnection(channelId);
    }

    const cachedConnections = await this.getCachedConnections();
    if (cachedConnections.length > 0) {
      return this.createManagersFromConnections(cachedConnections);
    }

    return await this.fetchAndCacheConnections();
  }

  async createConnection(data: Prisma.ConnectionCreateInput): Promise<ConnectionManager | null> {
    const existingConnection = await this.fetch(data.channelId);
    if (existingConnection) {
      return null;
    }

    const connection = await db.connection.create({ data });
    await cacheHubConnection(connection);
    return new ConnectionManager(connection);
  }

  async deleteConnection(channelId: string): Promise<ConnectionManager | null> {
    const connection = await this.fetch(channelId);
    if (!connection) {
      return null;
    }

    await connection.disconnect();
    return connection;
  }

  async setConnection(connection: Connection): Promise<ConnectionManager> {
    await cacheHubConnection(connection);
    return new ConnectionManager(connection);
  }

  // Private helper methods
  private buildCacheKey(hubId: string): string {
    return `${RedisKeys.Hub}:${hubId}:connections`;
  }

  private async getCachedConnections(): Promise<Connection[]> {
    const cached = await this.redis.hgetall(this.cacheKey);
    if (isEmpty(cached)) {
      return [];
    }

    return Object.values(cached).map((conn) => convertToConnectedList(JSON.parse(conn)));
  }

  private async fetchAndCacheConnections(): Promise<ConnectionManager[]> {
    const connections = await db.connection.findMany({
      where: { hubId: this.hub.id },
    });

    if (connections.length === 0) {
      return [];
    }

    await this.cacheConnections(connections);
    return this.createManagersFromConnections(connections);
  }

  private async getCachedConnection(channelId: string): Promise<Connection | null> {
    const rawConnection = await this.redis.hget(this.cacheKey, channelId);
    if (!rawConnection) {
      return null;
    }

    return convertToConnectedList(JSON.parse(rawConnection));
  }

  private async fetchAndCacheConnection(channelId: string): Promise<ConnectionManager | null> {
    const connection = await db.connection.findUnique({
      where: { channelId },
    });

    if (!connection) {
      return null;
    }

    return this.setConnection(connection);
  }

  private async cacheConnections(connections: Connection[]): Promise<void> {
    Logger.debug(`Caching ${connections.length} connections for hub ${this.hub.id}`);

    const keyValuePairs = connections.flatMap((conn) => [conn.channelId, JSON.stringify(conn)]);

    await this.redis.hset(this.cacheKey, keyValuePairs);
    await this.redis.expire(this.cacheKey, this.cacheConfig.expirationMs);

    Logger.debug(`Cached ${connections.length} connections for hub ${this.hub.id}`);
  }

  private createManagersFromConnections(connections: Connection[]): ConnectionManager[] {
    return connections.map((conn) => new ConnectionManager(conn));
  }
}
