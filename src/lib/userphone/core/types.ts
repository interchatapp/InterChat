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

import type { ActionRowBuilder, ButtonBuilder, Client } from 'discord.js';
import type { Redis } from 'ioredis';
import type {
  PrismaClient,
  Call,
  CallMessage as CallMessageDb,
  CallParticipant as CallParticipantDb,
} from '#src/generated/prisma/client/index.js';

// ============================================================================
// Core Call Types
// ============================================================================
export type { CallStatus } from '#src/generated/prisma/client/index.js';

export type CallMessage = Omit<CallMessageDb, 'id' | 'callId'>;

export type CallParticipant = Omit<CallParticipantDb, 'id' | 'callId'> & {
  users: Set<string>; // Set of user IDs who can see this message
};

export interface ActiveCall extends Omit<Call, 'updatedAt'> {
  readonly participants: CallParticipant[];
  messages: Omit<CallMessageDb, 'id' | 'callId'>[];
}


export interface CallRequest {
  readonly id: string;
  readonly channelId: string;
  readonly guildId: string;
  readonly initiatorId: string;
  readonly webhookUrl: string;
  readonly timestamp: number;
  readonly priority: number; // For queue ordering
  readonly clusterId?: number; // For distributed systems
}

// ============================================================================
// Operation Results
// ============================================================================

export interface CallResult {
  readonly success: boolean;
  readonly message: string;
  readonly callId?: string;
  readonly components?: ActionRowBuilder<ButtonBuilder>[];
}

export interface MatchResult {
  readonly matched: boolean;
  readonly callId?: string;
  readonly participants?: CallParticipant[];
  readonly matchTime?: number; // Time taken to find match in ms
}

export interface QueueStatus {
  readonly position: number;
  readonly queueLength: number;
}

// ============================================================================
// Performance Metrics
// ============================================================================

export interface CallMetrics {
  commandResponseTime: number;
  matchingTime: number;
  queueWaitTime: number;
  webhookCreationTime: number;
  databaseQueryTime: number;
}

export interface PerformanceTarget {
  readonly commandResponseTime: number; // <1000ms
  readonly matchingTime: number; // <10000ms
  readonly queueProcessingRate: number; // >100 matches/second
}

// ============================================================================
// Configuration
// ============================================================================

export interface CallingConfig {
  readonly client: Client;
  readonly redis: Redis;
  readonly database: PrismaClient;
  readonly performance: PerformanceTarget;
  readonly cache: CacheConfig;
  readonly matching: MatchingConfig;
}

export interface CacheConfig {
  readonly webhookTtlSecs: number; // 24 hours
  readonly callTtlSecs: number; // 1 hour
  readonly queueTtlSecs: number; // 30 minutes
}

export interface MatchingConfig {
  readonly backgroundInterval: number; // 1000ms
  readonly recentMatchTtlSecs: number; // 24 hours
  readonly queueTimeout: number; // 30 minutes
}

// ============================================================================
// Service Dependencies
// ============================================================================

// Note: Service interfaces are defined in interfaces.ts

// ============================================================================
// Events
// ============================================================================

export interface CallEvents {
  'call:queued': { request: CallRequest; queueStatus: QueueStatus };
  'call:matched': { call: ActiveCall; matchTime: number };
  'call:started': { call: ActiveCall };
  'call:ended': { call: ActiveCall; duration: number };
  'call:participant-joined': { callId: string; userId: string; channelId: string };
  'call:participant-left': { callId: string; userId: string; channelId: string };
  'call:message': { callId: string; message: CallMessage };
}

// ============================================================================
// Error Types
// ============================================================================

export class CallError extends Error {
  constructor(
    message: string,
    public readonly code: CallErrorCode,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CallError';
  }
}

export enum CallErrorCode {
  CHANNEL_ALREADY_IN_CALL = 'CHANNEL_ALREADY_IN_CALL',
  CHANNEL_ALREADY_IN_QUEUE = 'CHANNEL_ALREADY_IN_QUEUE',
  WEBHOOK_CREATION_FAILED = 'WEBHOOK_CREATION_FAILED',
  CALL_NOT_FOUND = 'CALL_NOT_FOUND',
  MATCHING_TIMEOUT = 'MATCHING_TIMEOUT',
  DATABASE_ERROR = 'DATABASE_ERROR',
  REDIS_ERROR = 'REDIS_ERROR',
  INVALID_CHANNEL = 'INVALID_CHANNEL',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
}
