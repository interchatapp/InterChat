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

import db from '#src/utils/Db.js';
import Logger from '#src/utils/Logger.js';
import type {
  Call,
  CallParticipant,
  CallMessage,
  CallStatus,
} from '#src/generated/prisma/client/client.js';
import getRedis from '#src/utils/Redis.js';
import { RedisKeys } from '#src/utils/Constants.js';
// Types imported for future use in migration scripts
// import type { ActiveCallData, CallData, CallParticipants } from './CallService.js';

/**
 * Service for managing call data in PostgreSQL database.
 * Handles migration from Redis-based storage to persistent database storage.
 */
export class CallDatabaseService {
  /**
   * Creates a new call in the database
   */
  async createCall(initiatorId: string): Promise<Call> {
    try {
      const call = await db.call.create({
        data: {
          initiatorId,
          status: 'QUEUED',
        },
        include: {
          participants: {
            include: {
              users: true,
            },
          },
          messages: true,
        },
      });

      Logger.debug(`Created new call ${call.id} for initiator ${initiatorId}`);
      return call;
    }
    catch (error) {
      Logger.error('Failed to create call in database:', error);
      throw error;
    }
  }

  /**
   * Adds a participant to a call
   */
  async addParticipant(
    callId: string,
    channelId: string,
    guildId: string,
    webhookUrl: string,
  ): Promise<CallParticipant> {
    try {
      const participant = await db.callParticipant.create({
        data: {
          callId,
          channelId,
          guildId,
          webhookUrl,
        },
        include: {
          users: true,
        },
      });

      Logger.debug(`Added participant ${participant.id} to call ${callId}`);
      return participant;
    }
    catch (error) {
      Logger.error(`Failed to add participant to call ${callId}:`, error);
      throw error;
    }
  }

  /**
   * Adds a user to a call participant
   */
  async addUserToParticipant(participantId: string, userId: string): Promise<void> {
    try {
      await db.callParticipantUser.upsert({
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

      Logger.debug(`Added user ${userId} to participant ${participantId}`);
    }
    catch (error) {
      Logger.error(`Failed to add user ${userId} to participant ${participantId}:`, error);
      throw error;
    }
  }

  /**
   * Removes a user from a call participant
   */
  async removeUserFromParticipant(participantId: string, userId: string): Promise<void> {
    try {
      await db.callParticipantUser.updateMany({
        where: {
          participantId,
          userId,
          leftAt: null,
        },
        data: {
          leftAt: new Date(),
        },
      });

      Logger.debug(`Removed user ${userId} from participant ${participantId}`);
    }
    catch (error) {
      Logger.error(`Failed to remove user ${userId} from participant ${participantId}:`, error);
      throw error;
    }
  }

  /**
   * Updates call status
   */
  async updateCallStatus(callId: string, status: CallStatus, endTime?: Date): Promise<void> {
    try {
      await db.call.update({
        where: { id: callId },
        data: {
          status,
          ...(endTime && { endTime }),
        },
      });

      Logger.debug(`Updated call ${callId} status to ${status}`);
    }
    catch (error) {
      Logger.error(`Failed to update call ${callId} status:`, error);
      throw error;
    }
  }

  /**
   * Adds a message to a call
   */
  async addMessage(
    callId: string,
    authorId: string,
    authorUsername: string,
    content: string,
    attachmentUrl?: string,
  ): Promise<CallMessage> {
    try {
      // First check if the call exists in the database
      const callExists = await db.call.findUnique({
        where: { id: callId },
        select: { id: true },
      });

      if (!callExists) {
        throw new Error(`Call ${callId} does not exist in database`);
      }

      const message = await db.callMessage.create({
        data: {
          callId,
          authorId,
          authorUsername,
          content,
          attachmentUrl,
        },
      });

      Logger.debug(`Added message ${message.id} to call ${callId}`);
      return message;
    }
    catch (error) {
      Logger.error(`Failed to add message to call ${callId}:`, error);
      throw error;
    }
  }

  /**
   * Gets an active call by channel ID
   */
  async getActiveCallByChannel(channelId: string): Promise<Call | null> {
    try {
      const call = await db.call.findFirst({
        where: {
          status: 'ACTIVE',
          participants: {
            some: {
              channelId,
              leftAt: null,
            },
          },
        },
        include: {
          participants: {
            include: {
              users: {
                where: {
                  leftAt: null,
                },
              },
            },
          },
          messages: {
            orderBy: {
              timestamp: 'desc',
            },
            take: 100, // Last 100 messages
          },
        },
      });

      return call;
    }
    catch (error) {
      Logger.error(`Failed to get active call for channel ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Gets a call by ID
   */
  async getCallById(callId: string): Promise<Call | null> {
    try {
      const call = await db.call.findUnique({
        where: { id: callId },
        include: {
          participants: {
            include: {
              users: true,
            },
          },
          messages: {
            orderBy: {
              timestamp: 'desc',
            },
            take: 100,
          },
        },
      });

      return call;
    }
    catch (error) {
      Logger.error(`Failed to get call ${callId}:`, error);
      return null;
    }
  }

  /**
   * Increments message count for a participant
   */
  async incrementParticipantMessageCount(participantId: string): Promise<void> {
    try {
      await db.callParticipant.update({
        where: { id: participantId },
        data: {
          messageCount: {
            increment: 1,
          },
        },
      });
    }
    catch (error) {
      Logger.error(`Failed to increment message count for participant ${participantId}:`, error);
    }
  }

  /**
   * Gets call statistics
   */
  async getCallStats(callId: string): Promise<{
    totalMessages: number;
    totalParticipants: number;
    duration: number | null;
  }> {
    try {
      const call = await db.call.findUnique({
        where: { id: callId },
        include: {
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

      return {
        totalMessages: call._count.messages,
        totalParticipants: call._count.participants,
        duration,
      };
    }
    catch (error) {
      Logger.error(`Failed to get call stats for ${callId}:`, error);
      return { totalMessages: 0, totalParticipants: 0, duration: null };
    }
  }

  /**
   * Cleans up expired call data based on retention policy:
   * - Normal calls: deleted 30 minutes after ending
   * - Reported calls: preserved indefinitely until moderation review
   * - Active calls: never deleted
   */
  async cleanupExpiredCalls(): Promise<{ deleted: number; protected: number; errors: number }> {
    const stats = { deleted: 0, protected: 0, errors: 0 };

    try {
      // Calculate 30 minutes ago
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      Logger.info('Starting cleanup of expired call data...');

      // Find all ended calls older than 30 minutes
      const expiredCalls = await db.call.findMany({
        where: {
          status: 'ENDED',
          endTime: {
            lt: thirtyMinutesAgo,
          },
        },
        select: {
          id: true,
          endTime: true,
          participants: {
            select: {
              id: true,
              messageCount: true,
            },
          },
          messages: {
            select: {
              id: true,
            },
          },
          _count: {
            select: {
              participants: true,
              messages: true,
            },
          },
        },
      });

      Logger.info(`Found ${expiredCalls.length} expired calls to evaluate for cleanup`);

      // Process each call individually to check for reports
      for (const call of expiredCalls) {
        try {
          // Check if this call has been reported (stored in Redis)
          const redis = getRedis();
          const reportKey = `${RedisKeys.Call}:report:${call.id}`;
          const hasReport = await redis.exists(reportKey);

          if (hasReport) {
            stats.protected++;
            Logger.info(`Protecting call ${call.id} from cleanup due to associated report`);
            continue;
          }

          // Safe to delete - no reports found
          await this.deleteCallData(call.id);
          stats.deleted++;

          Logger.info(
            `Cleaned up call ${call.id} (ended: ${call.endTime?.toISOString()}, ` +
              `participants: ${call._count.participants}, messages: ${call._count.messages})`,
          );
        }
        catch (error) {
          stats.errors++;
          Logger.error(`Failed to process call ${call.id} for cleanup:`, error);
        }
      }

      Logger.info(
        `Call cleanup completed - Deleted: ${stats.deleted}, Protected: ${stats.protected}, Errors: ${stats.errors}`,
      );

      return stats;
    }
    catch (error) {
      Logger.error('Failed to cleanup expired calls:', error);
      stats.errors++;
      return stats;
    }
  }

  /**
   * Safely deletes all data associated with a call
   */
  private async deleteCallData(callId: string): Promise<void> {
    try {
      /* TODO: Perhaps store specific call data for
         a call history command
      */

      // Use transaction to ensure data consistency
      await db.$transaction(async (tx) => {
        // Delete call participant users first (due to foreign key constraints)
        await tx.callParticipantUser.deleteMany({
          where: {
            participant: {
              callId,
            },
          },
        });

        // Delete call participants
        await tx.callParticipant.deleteMany({
          where: { callId },
        });

        // Delete call messages
        await tx.callMessage.deleteMany({
          where: { callId },
        });

        // Delete call ratings
        await tx.callRating.deleteMany({
          where: { callId },
        });

        // Finally delete the call itself
        await tx.call.delete({
          where: { id: callId },
        });
      });
    }
    catch (error) {
      Logger.error(`Failed to delete call data for ${callId}:`, error);
      throw error;
    }
  }
}
