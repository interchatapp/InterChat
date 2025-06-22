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

import Logger from '#src/utils/Logger.js';
import type { ClusterClient } from 'discord-hybrid-sharding';
import { calculateShardId, Client } from 'discord.js';
import type { Redis } from 'ioredis';
import { CallEventHandler } from '../core/events.js';
import { BroadcastService } from '#src/services/BroadcastService.js';
import type { ActiveCall } from '../core/types.js';

// Type definitions for cluster messages
interface ClusterMessage {
  type: string;
  data: unknown;
  sourceCluster?: number;
  targetCluster?: number;
  timestamp: number;
}

interface CallRequestData {
  request: unknown;
  sourceCluster: number;
}

interface CallMatchedData {
  call: ActiveCall;
  matchTime: number;
  sourceCluster: number;
}

interface CallEndedData {
  call: ActiveCall;
  duration: number;
  sourceCluster: number;
}

interface HeartbeatData {
  clusterId: number;
  timestamp: number;
}

/**
 * Coordinates call operations across multiple Discord bot clusters
 * Handles cross-shard communication and distributed state management
 */
export class ClusterCoordinator extends CallEventHandler {
  private readonly cluster: ClusterClient<Client>;
  private readonly redis: Redis;
  private readonly clusterId: number;
  private readonly isLeaderCluster: boolean;

  // Message types for inter-cluster communication
  private readonly messageTypes = {
    CALL_REQUEST: 'CALL_REQUEST',
    CALL_MATCHED: 'CALL_MATCHED',
    CALL_ENDED: 'CALL_ENDED',
    WEBHOOK_CREATED: 'WEBHOOK_CREATED',
    QUEUE_UPDATE: 'QUEUE_UPDATE',
    HEARTBEAT: 'HEARTBEAT',
  } as const;

  constructor(cluster: ClusterClient<Client>, redis: Redis) {
    super();
    this.cluster = cluster;
    this.redis = redis;
    this.clusterId = cluster.id;
    this.isLeaderCluster = cluster.id === 0; // Cluster 0 is the leader

    this.setupClusterMessaging();
    this.setupLeaderElection();
  }

  protected setupEventListeners(): void {
    // Listen for call events that need cross-cluster coordination
    this.subscribe('call:queued', async (data) => {
      await this.broadcastToAllClusters('CALL_REQUEST', {
        request: data.request,
        sourceCluster: this.clusterId,
      });
    });

    this.subscribe('call:matched', async (data) => {
      await this.broadcastToAllClusters('CALL_MATCHED', {
        call: data.call,
        matchTime: data.matchTime,
        sourceCluster: this.clusterId,
      });
    });

    this.subscribe('call:ended', async (data) => {
      await this.broadcastToAllClusters('CALL_ENDED', {
        call: data.call,
        duration: data.duration,
        sourceCluster: this.clusterId,
      });
    });
  }

  /**
   * Type guard to check if message is a cluster message
   */
  private isClusterMessage(message: unknown): message is ClusterMessage {
    return (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      'data' in message &&
      'timestamp' in message &&
      typeof (message as ClusterMessage).type === 'string' &&
      (message as ClusterMessage).type.startsWith('CALL_')
    );
  }

  /**
   * Setup cluster messaging for cross-shard communication
   */
  private setupClusterMessaging(): void {
    // Listen for messages from other clusters
    this.cluster.on('message', async (message) => {
      if (this.isClusterMessage(message)) {
        await this.handleClusterMessage(message);
      }
    });

    // Setup heartbeat for leader election
    if (this.isLeaderCluster) {
      setInterval(() => {
        this.sendHeartbeat();
      }, 5000); // Every 5 seconds
    }
  }

  /**
   * Handle messages from other clusters
   */
  private async handleClusterMessage(message: ClusterMessage): Promise<void> {
    try {
      switch (message.type) {
        case this.messageTypes.CALL_REQUEST:
          await this.handleRemoteCallRequest(message.data);
          break;
        case this.messageTypes.CALL_MATCHED:
          await this.handleRemoteCallMatched(message.data);
          break;
        case this.messageTypes.CALL_ENDED:
          await this.handleRemoteCallEnded(message.data);
          break;
        case this.messageTypes.WEBHOOK_CREATED:
          await this.handleRemoteWebhookCreated(message.data);
          break;
        case this.messageTypes.QUEUE_UPDATE:
          await this.handleRemoteQueueUpdate(message.data);
          break;
        case this.messageTypes.HEARTBEAT:
          await this.handleLeaderHeartbeat(message.data);
          break;
      }
    }
    catch (error) {
      Logger.error(`Error handling cluster message ${message.type}:`, error);
    }
  }

  /**
   * Broadcast message to all clusters
   */
  private async broadcastToAllClusters(type: string, data: unknown): Promise<void> {
    try {
      await this.cluster.broadcastEval(
        (client, ctx) => {
          // Don't send to self
          if ((client as unknown as Client).cluster.id === ctx.sourceCluster) return;

          (client as unknown as Client).cluster.send({
            type: ctx.type,
            data: ctx.data,
            sourceCluster: ctx.sourceCluster,
            timestamp: Date.now(),
          });
        },
        { context: { type, data, sourceCluster: this.clusterId } },
      );
    }
    catch (error) {
      Logger.error(`Error broadcasting ${type} to clusters:`, error);
    }
  }

  /**
   * Send message to specific cluster
   */
  async sendToCluster(clusterId: number, type: string, data: unknown): Promise<void> {
    try {
      await this.cluster.send({
        type,
        data,
        targetCluster: clusterId,
        sourceCluster: this.clusterId,
        timestamp: Date.now(),
      });
    }
    catch (error) {
      Logger.error(`Error sending ${type} to cluster ${clusterId}:`, error);
    }
  }

  /**
   * Check if a guild is on this cluster
   */
  async isGuildOnThisCluster(guildId: string): Promise<boolean> {
    try {
      const guild = this.cluster.client.guilds.cache.get(guildId);
      return !!guild;
    }
    catch (error) {
      Logger.error(`Error checking guild ${guildId} on cluster:`, error);
      return false;
    }
  }

  /**
   * Find which cluster has a specific guild
   */
  async findGuildCluster(guildId: string): Promise<number | null> {
    try {
      const results = await this.cluster.broadcastEval(
        (client, contextGuildId) => {
          const guild = client.guilds.cache.get(contextGuildId);
          return guild ? (client as unknown as Client).cluster.id : null;
        },
        { context: guildId, shard: calculateShardId(guildId, this.cluster.info.TOTAL_SHARDS) },
      );

      for (const result of results) {
        if (result !== null) {
          return result as number;
        }
      }

      return null;
    }
    catch (error) {
      Logger.error(`Error finding cluster for guild ${guildId}:`, error);
      return null;
    }
  }

  /**
   * Get webhook URL from any cluster
   */
  async getWebhookFromAnyCluster(channelId: string): Promise<string | null> {
    try {
      const results = await this.cluster.broadcastEval(
        async (client, _channelId) => {
          const channel = client.channels.cache.get(_channelId);
          if (!channel?.isSendable() || !('guild' in channel) || channel.isThread()) {
            return null;
          }

          // Try to get webhook from cache first
          const webhooks = await channel.fetchWebhooks().catch(() => null);
          const webhook = webhooks?.find((w) => w.owner?.id === client.user?.id);

          return webhook?.url || null;
        },
        { context: channelId },
      );

      for (const result of results) {
        if (result) {
          return result as string;
        }
      }

      return null;
    }
    catch (error) {
      Logger.error(`Error getting webhook for channel ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Send webhook message through appropriate cluster
   */
  async sendWebhookMessage(
    channelId: string,
    webhookUrl: string,
    content: string,
    components?: unknown[],
  ): Promise<boolean> {
    try {
      // Find which cluster has this channel
      const targetCluster = await this.findChannelCluster(channelId);

      if (targetCluster === null) {
        Logger.warn(`Could not find cluster for channel ${channelId}`);
        return false;
      }

      if (targetCluster === this.clusterId) {
        // Send directly if on this cluster
        return await this.sendWebhookMessageDirect(webhookUrl, content, components);
      }

      // Send to target cluster
      await this.sendToCluster(targetCluster, 'SEND_WEBHOOK_MESSAGE', {
        webhookUrl,
        content,
        components,
      });

      return true;
    }
    catch (error) {
      Logger.error(`Error sending webhook message to channel ${channelId}:`, error);
      return false;
    }
  }

  /**
   * Find which cluster has a specific channel
   */
  private async findChannelCluster(channelId: string): Promise<number | null> {
    try {
      const results = await this.cluster.broadcastEval(
        (client, contextChannelId) => {
          const channel = client.channels.cache.get(contextChannelId);
          return channel ? (client as unknown as Client).cluster.id : null;
        },
        { context: channelId },
      );

      for (const result of results) {
        if (result !== null) {
          return result as number;
        }
      }

      return null;
    }
    catch (error) {
      Logger.error(`Error finding cluster for channel ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Send webhook message directly (when on correct cluster)
   */
  private async sendWebhookMessageDirect(
    webhookUrl: string,
    content: string,
    components?: unknown[],
  ): Promise<boolean> {
    try {
      // Use existing BroadcastService.sendMessage
      const result = await BroadcastService.sendMessage(webhookUrl, {
        content,
        components: (components as never[]) || [],
      });

      return !result.error;
    }
    catch (error) {
      Logger.error('Error sending webhook message directly:', error);
      return false;
    }
  }

  // Event handlers for remote cluster messages
  private async handleRemoteCallRequest(data: unknown): Promise<void> {
    // Handle call request from another cluster
    const requestData = data as CallRequestData;
    Logger.debug(`Received call request from cluster ${requestData.sourceCluster}`);
  }

  private async handleRemoteCallMatched(data: unknown): Promise<void> {
    // Handle call match notification from another cluster
    const matchData = data as CallMatchedData;
    Logger.debug(`Received call match from cluster ${matchData.sourceCluster}`);
  }

  private async handleRemoteCallEnded(data: unknown): Promise<void> {
    // Handle call end notification from another cluster
    const endData = data as CallEndedData;
    Logger.debug(`Received call end from cluster ${endData.sourceCluster}`);
  }

  private async handleRemoteWebhookCreated(data: unknown): Promise<void> {
    // Handle webhook creation notification from another cluster
    const webhookData = data as { sourceCluster: number };
    Logger.debug(`Received webhook creation from cluster ${webhookData.sourceCluster}`);
  }

  private async handleRemoteQueueUpdate(data: unknown): Promise<void> {
    // Handle queue update from another cluster
    const queueData = data as { sourceCluster: number };
    Logger.debug(`Received queue update from cluster ${queueData.sourceCluster}`);
  }

  private async handleLeaderHeartbeat(data: unknown): Promise<void> {
    // Handle leader heartbeat for leader election
    const heartbeatData = data as HeartbeatData;
    await this.redis.setex('call:leader:heartbeat', 10, heartbeatData.clusterId.toString());
  }

  private async sendHeartbeat(): Promise<void> {
    await this.broadcastToAllClusters('HEARTBEAT', {
      clusterId: this.clusterId,
      timestamp: Date.now(),
    });
  }

  private setupLeaderElection(): void {
    // Simple leader election based on cluster ID and heartbeat
    setInterval(async () => {
      const currentLeader = await this.redis.get('call:leader:heartbeat');

      if (!currentLeader && this.clusterId === 0) {
        // Become leader if no current leader and we're cluster 0
        await this.redis.setex('call:leader:heartbeat', 10, this.clusterId.toString());
        Logger.info(`Cluster ${this.clusterId} became call system leader`);
      }
    }, 15000); // Check every 15 seconds
  }

  async handleEvent(): Promise<void> {
    // Implementation for event handling if needed
  }
}
