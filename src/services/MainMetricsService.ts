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

import { ShardMetric } from '#src/services/ShardMetricsService.js';
import Logger from '#utils/Logger.js';
import type { Cluster, ClusterManager } from 'discord-hybrid-sharding';
import type { Hono } from 'hono';
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export default class MainMetricsService {
  private registry: Registry;
  private clusterManager: ClusterManager;

  public readonly commandCounter: Counter;
  public readonly messageCounter: Counter;
  public readonly guildGauge: Gauge;
  public readonly hubGauge: Gauge;
  public readonly shardGauge: Gauge;
  public readonly clusterMemGauge: Gauge;

  constructor(clusterManager: ClusterManager) {
    this.registry = new Registry();

    // Enable default Node.js metrics
    collectDefaultMetrics({ register: this.registry });

    this.commandCounter = new Counter({
      name: 'interchat_command_usage_total',
      help: 'Total number of commands used',
      labelNames: ['command_name'],
      registers: [this.registry],
    });

    this.messageCounter = new Counter({
      name: 'interchat_messages_total',
      help: 'Total number of messages processed',
      labelNames: ['hub', 'cluster'],
      registers: [this.registry],
    });

    this.guildGauge = new Gauge({
      name: 'interchat_guilds_total',
      help: 'Total number of guilds',
      labelNames: ['cluster'],
      registers: [this.registry],
    });

    this.hubGauge = new Gauge({
      name: 'interchat_hubs_total',
      help: 'Total number of hubs',
      registers: [this.registry],
    });

    this.shardGauge = new Gauge({
      name: 'interchat_shards_status',
      help: 'Status of shards (1 = ready, 0 = disconnected)',
      labelNames: ['cluster', 'shard'],
      registers: [this.registry],
    });

    this.clusterMemGauge = new Gauge({
      name: 'interchat_cluster_memory_mb',
      help: 'Memory usage of cluster',
      labelNames: ['cluster'],
      registers: [this.registry],
    });

    this.clusterManager = clusterManager;

    this.clusterManager.on('clusterReady', (c) => {
      this.setupClusterListeners(c);
    });
  }

  private setupClusterListeners(cluster: Cluster) {
    cluster.on('message', (message) => {
      if ((message as ShardMetric).type === 'METRICS') {
        const { metric, value, labels } = (message as ShardMetric).data;
        switch (metric) {
          case 'command':
            this.commandCounter.inc({ command_name: labels.command });
            break;
          case 'message':
            this.messageCounter.inc({ ...labels });
            break;
          case 'guilds':
            this.guildGauge.set({ ...labels }, Number(value));
            break;
          case 'shard_status':
            this.shardGauge.set({ ...labels }, Number(value));
            break;
          case 'cluster_memory_mb':
            this.clusterMemGauge.set({ ...labels }, Number(value));
            break;
        }
      }
    });
  }

  public setupMetricsEndpoint(app: Hono): void {
    app.get('/metrics', async (c) => {
      const metrics = await this.registry.metrics();
      return c.text(metrics, 200, {
        'Content-Type': this.registry.contentType,
      });
    });
    Logger.info('Metrics endpoint added at /metrics');
  }
}
