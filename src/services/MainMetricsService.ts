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
import type db from '#src/utils/Db.js';
import Logger from '#utils/Logger.js';
import type { Cluster, ClusterManager } from 'discord-hybrid-sharding';
import type { Hono } from 'hono';
import { Counter, Gauge, Registry, collectDefaultMetrics, Histogram } from 'prom-client';

export default class MainMetricsService {
  private registry: Registry;
  private clusterManager: ClusterManager;

  // Existing metrics
  public readonly commandCounter: Counter;
  public readonly messageCounter: Counter;
  public readonly guildGauge: Gauge;
  public readonly hubGauge: Gauge;
  public readonly shardGauge: Gauge;
  public readonly clusterMemGauge: Gauge;
  public readonly queryCounter: Counter;

  // Business metrics
  public readonly userEngagementGauge: Gauge;
  public readonly hubActivityGauge: Gauge;
  public readonly connectionHealthGauge: Gauge;
  public readonly errorRateCounter: Counter;
  public readonly responseTimeHistogram: Histogram<string>;
  public readonly featureUsageCounter: Counter;
  public readonly webhookDeliveryCounter: Counter;
  public readonly redisOperationsCounter: Counter;
  public readonly apiEndpointCounter: Counter;

  constructor(clusterManager: ClusterManager, database: typeof db) {
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

    this.queryCounter = new Counter({
      name: 'interchat_db_queries_total',
      help: 'Total number of database queries',
      registers: [this.registry],
    });

    // business metrics
    this.userEngagementGauge = new Gauge({
      name: 'interchat_user_engagement',
      help: 'User engagement metrics',
      labelNames: ['metric_type', 'time_period'],
      registers: [this.registry],
    });

    this.hubActivityGauge = new Gauge({
      name: 'interchat_hub_activity',
      help: 'Hub activity and health metrics',
      labelNames: ['hub_id', 'hub_name', 'metric_type'],
      registers: [this.registry],
    });

    this.connectionHealthGauge = new Gauge({
      name: 'interchat_connection_health',
      help: 'Connection health and status metrics',
      labelNames: ['server_id', 'hub_id', 'status'],
      registers: [this.registry],
    });

    this.errorRateCounter = new Counter({
      name: 'interchat_errors_total',
      help: 'Total number of errors by type and severity',
      labelNames: ['error_type', 'severity', 'component'],
      registers: [this.registry],
    });

    this.responseTimeHistogram = new Histogram({
      name: 'interchat_response_time_seconds',
      help: 'Response time distribution for various operations',
      labelNames: ['operation_type', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [this.registry],
    });

    this.featureUsageCounter = new Counter({
      name: 'interchat_feature_usage_total',
      help: 'Feature usage tracking',
      labelNames: ['feature_name', 'user_type'],
      registers: [this.registry],
    });

    this.webhookDeliveryCounter = new Counter({
      name: 'interchat_webhook_deliveries_total',
      help: 'Webhook delivery success/failure tracking',
      labelNames: ['status', 'hub_id'],
      registers: [this.registry],
    });

    this.redisOperationsCounter = new Counter({
      name: 'interchat_redis_operations_total',
      help: 'Redis operations tracking',
      labelNames: ['operation_type', 'status'],
      registers: [this.registry],
    });

    this.apiEndpointCounter = new Counter({
      name: 'interchat_api_requests_total',
      help: 'API endpoint request tracking',
      labelNames: ['endpoint', 'method', 'status_code'],
      registers: [this.registry],
    });

    this.setupDatabaseListeners(database);

    this.clusterManager = clusterManager;
    this.clusterManager.on('clusterReady', (c) => {
      this.setupClusterListeners(c);
    });
  }

  private setupDatabaseListeners(database: typeof db) {
    database.$on('query', () => this.queryCounter.inc());
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

  // metric tracking methods
  public trackUserEngagement(metricType: string, timePeriod: string, value: number): void {
    this.userEngagementGauge.set({ metric_type: metricType, time_period: timePeriod }, value);
  }

  public trackHubActivity(hubId: string, hubName: string, metricType: string, value: number): void {
    this.hubActivityGauge.set({ hub_id: hubId, hub_name: hubName, metric_type: metricType }, value);
  }

  public trackConnectionHealth(
    serverId: string,
    hubId: string,
    status: string,
    value: number,
  ): void {
    this.connectionHealthGauge.set({ server_id: serverId, hub_id: hubId, status }, value);
  }

  public trackError(errorType: string, severity: string, component: string): void {
    this.errorRateCounter.inc({ error_type: errorType, severity, component });
  }

  public trackResponseTime(operationType: string, status: string, duration: number): void {
    this.responseTimeHistogram.observe({ operation_type: operationType, status }, duration);
  }

  public trackFeatureUsage(featureName: string, userType: string): void {
    this.featureUsageCounter.inc({ feature_name: featureName, user_type: userType });
  }

  public trackWebhookDelivery(status: string, hubId: string): void {
    this.webhookDeliveryCounter.inc({ status, hub_id: hubId });
  }

  public trackRedisOperation(operationType: string, status: string): void {
    this.redisOperationsCounter.inc({ operation_type: operationType, status });
  }

  public trackApiRequest(endpoint: string, method: string, statusCode: string): void {
    this.apiEndpointCounter.inc({ endpoint, method, status_code: statusCode });
  }
}
