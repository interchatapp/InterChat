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

import type { ClusterClient } from 'discord-hybrid-sharding';
import type { Client, GuildTextBasedChannel } from 'discord.js';
import type { ActiveCall, CallingConfig, CallResult } from './core/types.js';

// Distributed service implementations
import { ClusterCoordinator } from './distributed/ClusterCoordinator.js';
import { DistributedMatchingEngine } from './distributed/DistributedMatchingEngine.js';
import { DistributedQueueManager } from './distributed/DistributedQueueManager.js';
import { DistributedStateManager } from './distributed/DistributedStateManager.js';

// Core services (reused)
import { CacheManager } from './infrastructure/cache/CacheManager.js';
import { CallRepository } from './infrastructure/database/CallRepository.js';
import { CallMetrics } from './infrastructure/metrics/CallMetrics.js';
import { CallManager } from './services/CallManager.js';
import { NotificationService } from './services/NotificationService.js';

// Event system
import { callEventBus } from './core/events.js';

import Logger from '#src/utils/Logger.js';


/**
 * Distributed calling library for multi-cluster Discord bot deployment
 * Handles cross-shard communication and distributed state management
 */
export class DistributedCallingLibrary {
  private readonly config: CallingConfig;
  private readonly cluster: ClusterClient<Client>;
  private readonly clusterId: number;

  // Distributed coordination services
  private readonly coordinator: ClusterCoordinator;
  private readonly stateManager: DistributedStateManager;

  // Core services (adapted for distributed environment)
  private readonly queueManager: DistributedQueueManager;
  private readonly matchingEngine: DistributedMatchingEngine;
  private readonly cacheManager: CacheManager;
  private readonly repository: CallRepository;
  private readonly notificationService: NotificationService;
  private readonly metrics: CallMetrics;
  private readonly callManager: CallManager;

  // Event handling removed for performance

  private isInitialized = false;

  constructor(config: CallingConfig, cluster: ClusterClient<Client>) {
    this.config = config;
    this.cluster = cluster;
    this.clusterId = cluster.id;

    // Initialize distributed coordination
    this.coordinator = new ClusterCoordinator(this.cluster, config.redis);
    this.stateManager = new DistributedStateManager(
      config.redis,
      config.database,
      this.coordinator,
      this.clusterId,
    );

    // Initialize core services with distributed awareness
    this.metrics = new CallMetrics();
    this.repository = new CallRepository(config.database);
    this.cacheManager = new CacheManager(config.redis, config.cache);

    // Simplified distributed queue
    this.queueManager = new DistributedQueueManager(
      config.redis,
      this.clusterId,
      config.matching.queueTimeout,
    );

    this.matchingEngine = new DistributedMatchingEngine(
      this.queueManager,
      this.cacheManager,
      this.clusterId,
      config.matching.backgroundInterval,
    );

    this.notificationService = new NotificationService(config.client);

    // Call manager with distributed state
    this.callManager = new CallManager(
      this.queueManager,
      this.cacheManager,
      this.repository,
      this.notificationService,
      this.metrics,
      config.client, // Pass client for channel access
      this.stateManager, // Pass distributed state manager
    );
  }

  /**
   * Initialize the distributed calling library
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      Logger.warn(`DistributedCallingLibrary is already initialized on cluster ${this.clusterId}`);
      return;
    }

    const startTime = Date.now();
    Logger.info(`Initializing DistributedCallingLibrary on cluster ${this.clusterId}...`);

    try {
      // Start the distributed matching engine (with leader election)
      await this.matchingEngine.start();

      this.isInitialized = true;

      const initTime = Date.now() - startTime;
      Logger.info(
        `DistributedCallingLibrary initialized successfully on cluster ${this.clusterId} in ${initTime}ms`,
      );

      // Report initial status
      await this.reportDistributedStatus();
    }
    catch (error) {
      Logger.error(
        `Failed to initialize DistributedCallingLibrary on cluster ${this.clusterId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Shutdown the distributed calling library
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    Logger.info(`Shutting down DistributedCallingLibrary on cluster ${this.clusterId}...`);

    try {
      // Stop distributed services
      await this.matchingEngine.stop();

      this.isInitialized = false;
      Logger.info(`DistributedCallingLibrary shutdown completed on cluster ${this.clusterId}`);
    }
    catch (error) {
      Logger.error(
        `Error during DistributedCallingLibrary shutdown on cluster ${this.clusterId}:`,
        error,
      );
    }
  }

  // ============================================================================
  // Public API - Call Operations (Cross-Cluster Compatible)
  // ============================================================================

  /**
   * Initiate a new call (cross-cluster compatible)
   */
  async initiateCall(channel: GuildTextBasedChannel, initiatorId: string): Promise<CallResult> {
    this.ensureInitialized();

    try {
      // Cross-cluster forwarding adds significant latency, so process locally
      const result = await this.callManager.initiateCall(channel, initiatorId);
      return result;
    }
    catch (error) {
      Logger.error(`Error in initiateCall for channel ${channel.id}:`, error);
      return {
        success: false,
        message: 'Failed to initiate call. Please try again.',
      };
    }
  }

  /**
   * End an active call or remove from queue - optimized for speed
   */
  async hangupCall(channelId: string): Promise<CallResult> {
    this.ensureInitialized();

    try {
      const result = await this.callManager.hangupCall(channelId);
      return result;
    }
    catch (error) {
      Logger.error(`Error in hangupCall for channel ${channelId}:`, error);
      return {
        success: false,
        message: 'Failed to end call. Please try again.',
      };
    }
  }

  /**
   * Skip current call and find new match - optimized for speed
   */
  async skipCall(channelId: string, userId: string): Promise<CallResult> {
    this.ensureInitialized();

    try {
      // Simplified: directly call manager without complex cluster checks
      const result = await this.callManager.skipCall(channelId, userId);
      return result;
    }
    catch (error) {
      Logger.error(`Error in skipCall for channel ${channelId}:`, error);
      return {
        success: false,
        message: 'Failed to skip call. Please try again.',
      };
    }
  }

  /**
   * Get active call for a channel (cross-cluster compatible)
   */
  async getActiveCall(channelId: string): Promise<ActiveCall | null> {
    this.ensureInitialized();
    return await this.stateManager.getActiveCallByChannel(channelId);
  }

  /**
   * Add participant to call (cross-cluster compatible)
   */
  async addParticipant(channelId: string, userId: string): Promise<boolean> {
    this.ensureInitialized();

    const call = await this.stateManager.getActiveCallByChannel(channelId);
    if (!call) return false;

    // Update distributed state
    await this.stateManager.updateCallParticipant(call.id, channelId, userId, 'joined');
    return true;
  }

  /**
   * Remove participant from call (cross-cluster compatible)
   */
  async removeParticipant(channelId: string, userId: string): Promise<boolean> {
    this.ensureInitialized();

    const call = await this.stateManager.getActiveCallByChannel(channelId);
    if (!call) return false;

    // Update distributed state
    await this.stateManager.updateCallParticipant(call.id, channelId, userId, 'left');
    return true;
  }

  /**
   * Update call with message (cross-cluster compatible)
   */
  async updateCallMessage(
    channelId: string,
    userId: string,
    username: string,
    content: string,
    attachmentUrl?: string,
  ): Promise<void> {
    this.ensureInitialized();

    const call = await this.stateManager.getActiveCallByChannel(channelId);
    if (!call) return;

    const message = {
      authorId: userId,
      authorUsername: username,
      content,
      timestamp: new Date(),
      attachmentUrl: attachmentUrl ?? null,
    };

    // Update distributed state
    await this.stateManager.addCallMessage(call.id, message);

    // Emit event for cross-cluster coordination
    callEventBus.emit('call:message', { callId: call.id, message });
  }

  /**
   * Get ended call data for reporting and rating purposes
   */
  async getEndedCallData(callId: string): Promise<ActiveCall | null> {
    this.ensureInitialized();

    try {
      // Try to get from Redis first (for recently ended calls)
      const redisKey = `call:ended:${callId}`;
      const redisData = await this.config.redis.get(redisKey);

      if (redisData) {
        const parsed = JSON.parse(redisData) as ActiveCall;
        // Ensure users are Sets (they might be serialized as arrays)
        if (parsed.participants) {
          parsed.participants.forEach((p) => {
            if (Array.isArray(p.users)) {
              p.users = new Set(p.users);
            }
          });
        }
        return parsed;
      }

      // If not in Redis, try to get from database
      const dbCall = await this.repository.getCallById(callId);
      return dbCall; // Repository already returns ActiveCall format
    }
    catch (error) {
      Logger.error(`Error getting ended call data for ${callId}:`, error);
      return null;
    }
  }

  // ============================================================================
  // Distributed System Management
  // ============================================================================

  /**
   * Get distributed system statistics
   */
  async getDistributedStats(): Promise<{
    cluster: {
      id: number;
      isLeader: boolean;
      activeCallsCount: number;
    };
    global: {
      totalActiveCalls: number;
      totalParticipants: number;
      queueLength: number;
      clusterDistribution: Record<number, number>;
    };
    performance: {
      averageMatchTime: number;
      successRate: number;
      commandResponseTime: number;
    };
  }> {
    const stateStats = await this.stateManager.getStateStats();
    const queueStats = await this.queueManager.getDistributedQueueStats();
    const matchingStats = await this.matchingEngine.getMatchingStats();
    const performanceStats = await this.metrics.getStats();

    return {
      cluster: {
        id: this.clusterId,
        isLeader: (this.matchingEngine as unknown as { isLeader?: boolean }).isLeader || false,
        activeCallsCount: stateStats.activeCallsCount,
      },
      global: {
        totalActiveCalls: stateStats.activeCallsCount,
        totalParticipants: stateStats.totalParticipants,
        queueLength: queueStats.globalLength,
        clusterDistribution: queueStats.clusterDistribution,
      },
      performance: {
        averageMatchTime: matchingStats.averageMatchTime,
        successRate: matchingStats.successRate,
        commandResponseTime: performanceStats.averageCommandTime,
      },
    };
  }

  // Private helper methods

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error(`DistributedCallingLibrary not initialized on cluster ${this.clusterId}`);
    }
  }

  // Removed forwardCallToCluster method for performance optimization

  private async reportDistributedStatus(): Promise<void> {
    try {
      const stats = await this.getDistributedStats();

      Logger.info('Distributed Calling System Status:', {
        clusterId: stats.cluster.id,
        isLeader: stats.cluster.isLeader,
        activeCallsOnCluster: stats.cluster.activeCallsCount,
        globalActiveCalls: stats.global.totalActiveCalls,
        globalQueueLength: stats.global.queueLength,
        averageMatchTime: `${stats.performance.averageMatchTime.toFixed(2)}ms`,
        successRate: `${(stats.performance.successRate * 100).toFixed(2)}%`,
      });
    }
    catch (error) {
      Logger.error('Error reporting distributed status:', error);
    }
  }

  /**
   * Cleanup resources when the library is being destroyed
   */
  async cleanup(): Promise<void> {
    Logger.info('🧹 Starting DistributedCallingLibrary cleanup...');

    try {
      // Cleanup cache manager
      if (this.cacheManager) {
        await this.cacheManager.clearCache();
        Logger.debug('✅ Cache manager cleaned up');
      }

      // Note: Other managers don't have cleanup methods yet, but we can add them later
      // For now, just log that we're cleaning up the library
      Logger.debug('✅ Queue manager, state manager, and coordinator cleanup skipped (no cleanup methods)');

      Logger.info('✅ DistributedCallingLibrary cleanup completed');
    }
    catch (error) {
      Logger.error('❌ Error during DistributedCallingLibrary cleanup:', error);
    }
  }
}
