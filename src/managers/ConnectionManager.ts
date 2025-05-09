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

import type { HexColorString } from 'discord.js';
import type { Connection, Prisma } from '#src/generated/prisma/client/client.js';
import { HubService } from '#src/services/HubService.js';
import { MessageProcessor } from '#src/services/MessageProcessor.js';
import db from '#src/utils/Db.js';

export default class ConnectionManager {
  private readonly hubService = new HubService();
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
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
    return await this.hubService.fetchHub(this.hubId);
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

    await MessageProcessor.onConnectionModified(this.channelId);
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

  private async connectionExists(): Promise<boolean> {
    return (
      (await db.connection.findFirst({
        where: { id: this.connection.id },
      })) !== null
    );
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

    // Invalidate cache for this connection
    await MessageProcessor.onConnectionModified(this.channelId);

    // If the channelId is being changed, invalidate new channelId
    if (data.channelId && typeof data.channelId === 'string' && data.channelId !== this.channelId) {
      await MessageProcessor.onConnectionModified(data.channelId);
    }
  }
}
