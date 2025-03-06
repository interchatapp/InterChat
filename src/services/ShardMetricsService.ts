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

import type InterChatClient from '#src/core/BaseClient.js';

export interface ShardMetricsData {
  metric: string;
  value?: number;
  labels: Record<string, string>;
}

export interface ShardMetric {
  type: string;
  data: ShardMetricsData;
}

export class ShardMetricsService {
  private static instance: ShardMetricsService;
  private client: InterChatClient;

  private constructor(client: InterChatClient) {
    this.client = client;
  }

  public static init(client: InterChatClient): ShardMetricsService {
    if (!ShardMetricsService.instance) {
      ShardMetricsService.instance = new ShardMetricsService(client);
    }
    return ShardMetricsService.instance;
  }

  public incrementCommand(commandName: string): void {
    this.client.cluster.send({
      type: 'METRICS',
      data: {
        metric: 'command',
        labels: { command: commandName },
      },
    });
  }

  public incrementMessage(hubId: string): void {
    this.client.cluster.send({
      type: 'METRICS',
      data: {
        metric: 'message',
        labels: {
          hub_id: hubId,
          cluster: this.client.cluster.id.toString(),
        },
      },
    });
  }

  public updateGuildCount(count: number): void {
    this.client.cluster.send({
      type: 'METRICS',
      data: {
        metric: 'guilds',
        value: count,
        labels: {
          cluster: this.client.cluster.id.toString(),
        },
      },
    });
  }

  public updateShardStatus(shardId: number, status: boolean): void {
    this.client.cluster.send({
      type: 'METRICS',
      data: {
        metric: 'shard_status',
        value: status ? 1 : 0,
        labels: {
          cluster: this.client.cluster.id.toString(),
          shard: shardId.toString(),
        },
      },
    });
  }
}
