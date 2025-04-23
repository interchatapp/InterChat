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
import ConnectionManager from '#src/managers/ConnectionManager.js';
import type HubManager from '#src/managers/HubManager.js';
import db from '#src/utils/Db.js';

export default class HubConnectionsManager {
  private readonly hub: HubManager;

  constructor(hub: HubManager) {
    this.hub = hub;
  }

  async fetch(channelId: string): Promise<ConnectionManager | null>;
  async fetch(): Promise<ConnectionManager[]>;
  async fetch(channelId?: string): Promise<ConnectionManager[] | ConnectionManager | null> {
    if (channelId) {
      return this.fetchConnection(channelId);
    }

    return await this.fetchConnections();
  }

  async createConnection(data: Prisma.ConnectionCreateInput): Promise<ConnectionManager | null> {
    const existingConnection = await this.fetch(data.channelId);
    if (existingConnection) {
      return null;
    }

    const connection = await db.connection.create({ data });
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
    return new ConnectionManager(connection);
  }

  private async fetchConnections(): Promise<ConnectionManager[]> {
    const connections = await db.connection.findMany({
      where: { hubId: this.hub.id },
    });

    if (connections.length === 0) {
      return [];
    }

    return this.createManagersFromConnections(connections);
  }

  private async fetchConnection(channelId: string): Promise<ConnectionManager | null> {
    const connection = await db.connection.findUnique({
      where: { channelId },
    });

    if (!connection || connection.hubId !== this.hub.id) {
      return null;
    }

    return this.setConnection(connection);
  }

  private createManagersFromConnections(connections: Connection[]): ConnectionManager[] {
    return connections.map((conn) => new ConnectionManager(conn));
  }
}
