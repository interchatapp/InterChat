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

import type { PrismaClient } from '#src/generated/prisma/client/client.js';
import type { ICallRepository } from '../../core/interfaces.js';
import type { ActiveCall } from '../../core/types.js';
import Logger from '#src/utils/Logger.js';

/**
 * Optimized database repository for call operations
 * Focuses on minimal queries and efficient data access patterns
 */
export class CallRepository implements ICallRepository {
  private readonly db: PrismaClient;

  constructor(database: PrismaClient) {
    this.db = database;
  }

  /**
   * Create new call in database (lean operation)
   */
  async createCall(initiatorId: string): Promise<{ id: string }> {
    const startTime = performance.now();

    try {
      // Create call without heavy includes - just return the ID
      const call = await this.db.call.create({
        data: {
          initiatorId,
          status: 'QUEUED',
        },
        select: {
          id: true, // Only select what we need
        },
      });

      Logger.debug(`Created call ${call.id} in ${performance.now() - startTime}ms`);
      return call;
    }
    catch (error) {
      Logger.error('Failed to create call:', error);
      throw error;
    }
  }

  /**
   * Update call status efficiently
   */
  async updateCallStatus(callId: string, status: string, endTime?: Date): Promise<void> {
    const startTime = performance.now();

    try {
      await this.db.call.update({
        where: { id: callId },
        data: {
          status: status as never,
          ...(endTime && { endTime }),
        },
      });

      Logger.debug(
        `Updated call ${callId} status to ${status} in ${performance.now() - startTime}ms`,
      );
    }
    catch (error) {
      Logger.error(`Failed to update call ${callId} status:`, error);
      throw error;
    }
  }

  /**
   * Add participant to call (lean operation)
   */
  async addParticipant(
    callId: string,
    channelId: string,
    guildId: string,
    webhookUrl: string,
  ): Promise<{ id: string }> {
    const startTime = performance.now();

    try {
      const participant = await this.db.callParticipant.create({
        data: {
          callId,
          channelId,
          guildId,
          webhookUrl,
        },
        select: {
          id: true, // Only select what we need
        },
      });

      Logger.debug(
        `Added participant ${participant.id} to call ${callId} in ${performance.now() - startTime}ms`,
      );
      return participant;
    }
    catch (error) {
      Logger.error(`Failed to add participant to call ${callId}:`, error);
      throw error;
    }
  }

  /**
   * Add user to participant using upsert for efficiency
   */
  async addUserToParticipant(participantId: string, userId: string): Promise<void> {
    const startTime = performance.now();

    try {
      await this.db.callParticipantUser.upsert({
        where: {
          participantId_userId: {
            participantId,
            userId,
          },
        },
        update: {
          leftAt: null, // User rejoined
        },
        create: {
          participantId,
          userId,
        },
      });

      Logger.debug(
        `Added user ${userId} to participant ${participantId} in ${performance.now() - startTime}ms`,
      );
    }
    catch (error) {
      Logger.error(`Failed to add user ${userId} to participant ${participantId}:`, error);
      throw error;
    }
  }

  /**
   * Remove user from participant efficiently
   */
  async removeUserFromParticipant(participantId: string, userId: string): Promise<void> {
    const startTime = performance.now();

    try {
      await this.db.callParticipantUser.updateMany({
        where: {
          participantId,
          userId,
          leftAt: null,
        },
        data: {
          leftAt: new Date(),
        },
      });

      Logger.debug(
        `Removed user ${userId} from participant ${participantId} in ${performance.now() - startTime}ms`,
      );
    }
    catch (error) {
      Logger.error(`Failed to remove user ${userId} from participant ${participantId}:`, error);
      throw error;
    }
  }

  /**
   * Add message to call (optimized)
   */
  async addMessage(
    callId: string,
    authorId: string,
    authorUsername: string,
    content: string,
    attachmentUrl?: string,
  ): Promise<void> {
    const startTime = performance.now();

    try {
      // Skip existence check - let foreign key constraint handle it
      // This eliminates an unnecessary database round trip
      await this.db.callMessage.create({
        data: {
          callId,
          authorId,
          authorUsername,
          content,
          attachmentUrl,
        },
      });

      Logger.debug(`Added message to call ${callId} in ${performance.now() - startTime}ms`);
    }
    catch (error) {
      // Handle foreign key constraint errors gracefully
      if (error.code === 'P2003') {
        Logger.warn(`Call ${callId} does not exist when adding message`);
        return;
      }

      Logger.error(`Failed to add message to call ${callId}:`, error);
      throw error;
    }
  }

  /**
   * Get active call by channel (optimized query)
   */
  async getActiveCallByChannel(channelId: string): Promise<ActiveCall | null> {
    const startTime = performance.now();

    try {
      const call = await this.db.call.findFirst({
        where: {
          status: 'ACTIVE',
          participants: {
            some: {
              channelId,
              leftAt: null,
            },
          },
        },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          initiatorId: true,
          createdAt: true,
          participants: {
            select: {
              channelId: true,
              guildId: true,
              webhookUrl: true,
              messageCount: true,
              joinedAt: true,
              users: {
                where: {
                  leftAt: null,
                },
                select: {
                  userId: true,
                },
              },
            },
          },
          // Don't load messages here - they can be loaded separately if needed
        },
      });

      if (!call) {
        return null;
      }

      // Transform to ActiveCall format
      const activeCall: ActiveCall = {
        ...call,
        status: 'ACTIVE',
        participants: call.participants.map((p) => ({
          channelId: p.channelId,
          guildId: p.guildId,
          webhookUrl: p.webhookUrl,
          users: new Set(p.users.map((u) => u.userId)),
          messageCount: p.messageCount,
          joinedAt: p.joinedAt,
          leftAt: null, // Active calls won't have leftAt set
        })),
        messages: [], // Load separately if needed
      };

      Logger.debug(`Retrieved active call ${call.id} in ${performance.now() - startTime}ms`);
      return activeCall;
    }
    catch (error) {
      Logger.error(`Failed to get active call for channel ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Get call by ID (for ended call data retrieval)
   */
  async getCallById(callId: string): Promise<ActiveCall | null> {
    const startTime = performance.now();

    try {
      const call = await this.db.call.findUnique({
        where: { id: callId },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          status: true,
          initiatorId: true,
          createdAt: true,
          participants: {
            select: {
              channelId: true,
              guildId: true,
              webhookUrl: true,
              messageCount: true,
              joinedAt: true,
              users: {
                select: {
                  userId: true,
                },
              },
            },
          },
          messages: {
            select: {
              authorId: true,
              authorUsername: true,
              content: true,
              timestamp: true,
              attachmentUrl: true,
            },
          },
        },
      });

      if (!call) {
        return null;
      }

      // Transform to ActiveCall format
      const activeCall: ActiveCall = {
        ...call,
        participants: call.participants.map((p) => ({
          ...p,
          joinedAt: p.joinedAt,
          leftAt: null,
          users: new Set(p.users.map((u) => u.userId)),
        })),
      };

      Logger.debug(`Retrieved call ${call.id} in ${performance.now() - startTime}ms`);
      return activeCall;
    }
    catch (error) {
      Logger.error(`Failed to get call ${callId}:`, error);
      return null;
    }
  }

  /**
   * Get call statistics efficiently
   */
  async getCallStats(callId: string): Promise<{
    totalMessages: number;
    totalParticipants: number;
    duration: number | null;
  }> {
    const startTime = performance.now();

    try {
      const call = await this.db.call.findUnique({
        where: { id: callId },
        select: {
          startTime: true,
          endTime: true,
          _count: {
            select: {
              messages: true,
              participants: true,
            },
          },
        },
      });

      if (!call) {
        return { totalMessages: 0, totalParticipants: 0, duration: null };
      }

      const duration =
        call.endTime && call.startTime ? call.endTime.getTime() - call.startTime.getTime() : null;

      const stats = {
        totalMessages: call._count.messages,
        totalParticipants: call._count.participants,
        duration,
      };

      Logger.debug(`Retrieved call stats for ${callId} in ${performance.now() - startTime}ms`);
      return stats;
    }
    catch (error) {
      Logger.error(`Failed to get call stats for ${callId}:`, error);
      return { totalMessages: 0, totalParticipants: 0, duration: null };
    }
  }

  /**
   * Batch create participants for better performance
   */
  async batchCreateParticipants(
    participants: Array<{
      callId: string;
      channelId: string;
      guildId: string;
      webhookUrl: string;
    }>,
  ): Promise<void> {
    const startTime = performance.now();

    try {
      await this.db.callParticipant.createMany({
        data: participants,
        skipDuplicates: true,
      });

      Logger.debug(
        `Batch created ${participants.length} participants in ${performance.now() - startTime}ms`,
      );
    }
    catch (error) {
      Logger.error('Failed to batch create participants:', error);
      throw error;
    }
  }

  /**
   * Cleanup old call data efficiently
   */
  async cleanupOldCalls(olderThanHours: number = 48): Promise<number> {
    const startTime = performance.now();

    try {
      const cutoffDate = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

      const result = await this.db.call.deleteMany({
        where: {
          status: 'ENDED',
          endTime: {
            lt: cutoffDate,
          },
        },
      });

      Logger.info(`Cleaned up ${result.count} old calls in ${performance.now() - startTime}ms`);
      return result.count;
    }
    catch (error) {
      Logger.error('Failed to cleanup old calls:', error);
      return 0;
    }
  }
}
