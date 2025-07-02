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

import type { Redis } from 'ioredis';
import type { PrismaClient } from '#src/generated/prisma/client/client.js';
import type { ActiveCall, CallMessage } from '../core/types.js';
import type { ClusterCoordinator } from './ClusterCoordinator.js';
import { CallEventHandler } from '../core/events.js';
import Logger from '#src/utils/Logger.js';
import { ConvertDatesToString } from '#src/types/Utils.js';

/**
 * Simplified distributed state manager with reduced Redis operations
 * Uses atomic operations instead of complex locking
 */
export class DistributedStateManager extends CallEventHandler {
  private readonly redis: Redis;
  private readonly database: PrismaClient;
  private readonly clusterId: number;

  // Simplified Redis keys
  private readonly keys = {
    activeCalls: 'call:active:v2',
    channelToCall: 'call:channel:mapping:v2',
  };

  private readonly stateTimeout = 3600; // 1 hour

  constructor(
    redis: Redis,
    database: PrismaClient,
    _coordinator: ClusterCoordinator, // Keep for compatibility
    clusterId: number,
  ) {
    super();
    this.redis = redis;
    this.database = database;
    this.clusterId = clusterId;
  }

  protected setupEventListeners(): void {
    // Sync state when calls are created/updated
    this.subscribe('call:matched', async (data) => {
      await this.syncActiveCall(data.call);
    });

    this.subscribe('call:ended', async (data) => {
      await this.removeActiveCall(data.call.id);
    });

    this.subscribe('call:participant-joined', async (data) => {
      await this.updateCallParticipant(data.callId, data.channelId, data.userId, 'joined');
    });

    this.subscribe('call:participant-left', async (data) => {
      await this.updateCallParticipant(data.callId, data.channelId, data.userId, 'left');
    });

    this.subscribe('call:message', async (data) => {
      await this.addCallMessage(data.callId, data.message);
    });

    // Cleanup expired state periodically
    setInterval(() => {
      this.cleanupExpiredState().catch((error) => {
        Logger.error('Error cleaning up expired state:', error);
      });
    }, 300000); // Every 5 minutes
  }

  /**
   * Simplified sync using atomic operations
   */
  async syncActiveCall(call: ActiveCall): Promise<void> {
    try {
      // Use atomic pipeline operations instead of locking
      const callData = this.serializeCall(call);
      const pipeline = this.redis.pipeline();

      // Store main call data
      pipeline.hset(this.keys.activeCalls, call.id, callData);
      pipeline.expire(this.keys.activeCalls, this.stateTimeout);

      // Create channel-to-call mappings
      for (const participant of call.participants) {
        pipeline.hset(this.keys.channelToCall, participant.channelId, call.id);
      }

      await pipeline.exec();

      // Persist to database asynchronously
      this.persistCallToDatabase(call).catch((error) => {
        Logger.error(`Error persisting call ${call.id} to database:`, error);
      });

      Logger.debug(`Synced active call ${call.id} state`);
    }
    catch (error) {
      Logger.error(`Error syncing active call ${call.id}:`, error);
    }
  }

  /**
   * Get active call state from distributed cache
   */
  async getActiveCall(callId: string): Promise<ActiveCall | null> {
    try {
      const callData = await this.redis.hget(this.keys.activeCalls, callId);
      if (!callData) {
        // Try to load from database
        return await this.loadCallFromDatabase(callId);
      }

      return this.deserializeCall(callData);
    }
    catch (error) {
      Logger.error(`Error getting active call ${callId}:`, error);
      return null;
    }
  }

  /**
   * Get active call by channel ID
   */
  async getActiveCallByChannel(channelId: string): Promise<ActiveCall | null> {
    try {
      const callId = await this.redis.hget(this.keys.channelToCall, channelId);
      if (!callId) {
        return null;
      }

      return await this.getActiveCall(callId);
    }
    catch (error) {
      Logger.error(`Error getting active call for channel ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Simplified participant update without locking
   */
  async updateCallParticipant(
    callId: string,
    channelId: string,
    userId: string,
    action: 'joined' | 'left',
  ): Promise<void> {
    try {
      const call = await this.getActiveCall(callId);
      if (!call) {
        return;
      }

      // Update participant
      const participant = call.participants.find((p) => p.channelId === channelId);
      if (!participant) {
        return;
      }

      if (action === 'joined') {
        participant.users.add(userId);
      }
      else {
        participant.users.delete(userId);
      }

      // Sync updated state
      await this.syncActiveCall(call);

      Logger.debug(`Updated participant ${userId} ${action} in call ${callId}`);
    }
    catch (error) {
      Logger.error(`Error updating participant in call ${callId}:`, error);
    }
  }

  /**
   * Simplified message addition
   */
  async addCallMessage(callId: string, message: CallMessage): Promise<void> {
    try {
      const call = await this.getActiveCall(callId);
      if (!call) {
        return;
      }

      // Add message to call
      call.messages.push(message);

      // Keep only last 50 messages (reduced for performance)
      if (call.messages.length > 50) {
        call.messages = call.messages.slice(-50);
      }

      // Sync updated state
      await this.syncActiveCall(call);

      Logger.debug(`Added message to call ${callId}`);
    }
    catch (error) {
      Logger.error(`Error adding message to call ${callId}:`, error);
    }
  }

  /**
   * Simplified call removal
   */
  async removeActiveCall(callId: string): Promise<void> {
    try {
      // Get call data before removal
      const call = await this.getActiveCall(callId);
      if (!call) {
        return;
      }

      const pipeline = this.redis.pipeline();

      // Remove from active calls
      pipeline.hdel(this.keys.activeCalls, callId);

      // Remove channel mappings
      for (const participant of call.participants) {
        pipeline.hdel(this.keys.channelToCall, participant.channelId);
      }

      await pipeline.exec();

      Logger.debug(`Removed active call ${callId} from state`);
    }
    catch (error) {
      Logger.error(`Error removing active call ${callId}:`, error);
    }
  }

  /**
   * Get all active calls across clusters
   */
  async getAllActiveCalls(): Promise<ActiveCall[]> {
    try {
      const callsData = await this.redis.hgetall(this.keys.activeCalls);
      const calls: ActiveCall[] = [];

      for (const [callId, callData] of Object.entries(callsData)) {
        try {
          const call = this.deserializeCall(callData);
          calls.push(call);
        }
        catch (parseError) {
          Logger.error(`Error parsing call data for ${callId}:`, parseError);
          // Clean up corrupted data
          await this.redis.hdel(this.keys.activeCalls, callId);
        }
      }

      return calls;
    }
    catch (error) {
      Logger.error('Error getting all active calls:', error);
      return [];
    }
  }

  /**
   * Get distributed state statistics
   */
  async getStateStats(): Promise<{
    activeCallsCount: number;
    totalParticipants: number;
    averageCallDuration: number;
    clusterDistribution: Record<number, number>;
  }> {
    try {
      const activeCalls = await this.getAllActiveCalls();
      const now = Date.now();

      let totalParticipants = 0;
      let totalDuration = 0;
      const clusterDistribution: Record<number, number> = {};

      for (const call of activeCalls) {
        // Count participants
        for (const p of call.participants) {
          totalParticipants += p.users.size;
        }

        // Calculate duration
        totalDuration += now - call.startTime.getTime();

        // Simplified cluster distribution - just show current cluster
        clusterDistribution[this.clusterId] = (clusterDistribution[this.clusterId] || 0) + 1;
      }

      const averageCallDuration = activeCalls.length > 0 ? totalDuration / activeCalls.length : 0;

      return {
        activeCallsCount: activeCalls.length,
        totalParticipants,
        averageCallDuration,
        clusterDistribution,
      };
    }
    catch (error) {
      Logger.error('Error getting state stats:', error);
      return {
        activeCallsCount: 0,
        totalParticipants: 0,
        averageCallDuration: 0,
        clusterDistribution: {},
      };
    }
  }

  // Private helper methods

  private serializeCall(call: ActiveCall): string {
    return JSON.stringify(call, (_key, value) => {
      if (value instanceof Set) {
        return Array.from(value);
      }
      return value;
    });
  }

  private deserializeCall(data: string): ActiveCall {
    let call = JSON.parse(data) as ConvertDatesToString<ActiveCall> | ActiveCall;

    // Convert timestamps to Date objects
    call = {
      ...call,
      startTime: new Date(call.startTime),
      endTime: call.endTime ? new Date(call.endTime) : null,
      createdAt: new Date(call.createdAt),
      // Convert messages to proper format
      messages: call.messages.map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
      // Convert participants
      participants: call.participants.map((p) => ({
        ...p,
        joinedAt: new Date(p.joinedAt),
        leftAt: p.leftAt ? new Date(p.leftAt) : null,
        users: new Set(p.users as unknown as string[]), // Convert back to Set
      })),
    } satisfies ActiveCall;

    return call;
  }

  private async persistCallToDatabase(call: ActiveCall): Promise<void> {
    try {
      // Update call status in database
      await this.database.call.upsert({
        where: { id: call.id },
        update: {
          status: call.status,
          endTime: call.endTime,
        },
        create: {
          id: call.id,
          initiatorId: call.participants[0]?.users.values().next().value || 'unknown',
          status: call.status,
          startTime: call.startTime,
          endTime: call.endTime,
        },
      });
    }
    catch (error) {
      Logger.error(`Error persisting call ${call.id} to database:`, error);
    }
  }

  private async loadCallFromDatabase(callId: string): Promise<ActiveCall | null> {
    try {
      const dbCall = await this.database.call.findUnique({
        where: { id: callId },
        include: {
          participants: {
            include: {
              users: {
                where: { leftAt: null },
              },
            },
          },
          messages: {
            orderBy: { timestamp: 'desc' },
            take: 100,
          },
        },
      });

      if (!dbCall || dbCall.status !== 'ACTIVE') {
        return null;
      }

      // Convert database call to ActiveCall format
      const activeCall: ActiveCall = {
        id: dbCall.id,
        initiatorId: dbCall.initiatorId,
        createdAt: dbCall.createdAt,
        startTime: dbCall.startTime,
        endTime: dbCall.endTime,
        status: dbCall.status as never,
        messages: dbCall.messages.map((m) => ({ ...m })),
        participants: dbCall.participants.map((p) => ({
          ...p,
          joinedAt: new Date(p.joinedAt),
          leftAt: p.leftAt ? new Date(p.leftAt) : null,
          users: new Set(p.users.map((u) => u.userId)),
        })),
      };

      // Cache in Redis for future access
      await this.syncActiveCall(activeCall);

      return activeCall;
    }
    catch (error) {
      Logger.error(`Error loading call ${callId} from database:`, error);
      return null;
    }
  }

  // Removed complex database methods to simplify architecture
  // Database operations are now handled asynchronously without blocking

  private async cleanupExpiredState(): Promise<void> {
    try {
      const activeCalls = await this.getAllActiveCalls();
      const now = Date.now();
      const maxCallDuration = 4 * 60 * 60 * 1000; // 4 hours

      for (const call of activeCalls) {
        const callAge = now - call.startTime.getTime();
        if (callAge > maxCallDuration) {
          Logger.info(
            `Cleaning up expired call ${call.id} (age: ${Math.round(callAge / 60000)} minutes)`,
          );
          await this.removeActiveCall(call.id);
        }
      }
    }
    catch (error) {
      Logger.error('Error cleaning up expired state:', error);
    }
  }

  async handleEvent(): Promise<void> {
    // Implementation for event handling if needed
  }
}
