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
import { CallEventHandler } from '../core/events.js';
import type { ICacheManager, IMatchingEngine } from '../core/interfaces.js';
import type { ActiveCall, CallParticipant, CallRequest, MatchResult } from '../core/types.js';
import type { DistributedQueueManager } from './DistributedQueueManager.js';

/**
 * Simplified distributed matching engine with efficient processing
 * Uses queue leader election for coordination
 */
export class DistributedMatchingEngine extends CallEventHandler implements IMatchingEngine {
  private readonly queueManager: DistributedQueueManager;
  private readonly cacheManager: ICacheManager;
  private readonly clusterId: number;

  private isRunning = false;
  private matchingInterval: NodeJS.Timeout | null = null;

  private readonly intervalMs: number;

  // Simplified performance tracking
  private matchingTimes: number[] = [];
  private successfulMatches = 0;
  private totalAttempts = 0;

  constructor(
    queueManager: DistributedQueueManager,
    cacheManager: ICacheManager,
    clusterId: number,
    intervalMs: number = 1000, // 1 second for faster processing
  ) {
    super();
    this.queueManager = queueManager;
    this.cacheManager = cacheManager;
    this.clusterId = clusterId;
    this.intervalMs = intervalMs;
  }

  protected setupEventListeners(): void {
    // Simplified event handling - just track metrics
    this.subscribe('call:matched', async (data) => {
      this.matchingTimes.push(data.matchTime);
      this.successfulMatches++;
    });
  }

  /**
   * Start the simplified matching process
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      Logger.warn('Matching engine is already running');
      return;
    }

    this.isRunning = true;
    Logger.info(`Starting matching engine on cluster ${this.clusterId}`);

    // Start matching process - only if queue leader
    this.startMatching();
  }

  /**
   * Stop the matching process
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.matchingInterval) {
      clearInterval(this.matchingInterval);
      this.matchingInterval = null;
    }

    Logger.info(`Matching engine stopped on cluster ${this.clusterId}`);
  }

  /**
   * Try to find a match for a specific request - simplified
   */
  async findMatch(request: CallRequest): Promise<MatchResult> {
    const startTime = Date.now();
    this.totalAttempts++;

    try {
      // Only process if this cluster is queue leader
      if (!this.queueManager.isQueueLeader()) {
        return { matched: false };
      }

      // Get all pending requests
      const pendingRequests = await this.queueManager.getPendingRequests();

      // Find compatible match
      const match = await this.findCompatibleMatch(request, pendingRequests);

      if (match) {
        const matchTime = Date.now() - startTime;
        this.matchingTimes.push(matchTime);
        this.successfulMatches++;

        // Create active call
        const activeCall = await this.createActiveCall(request, match);

        // Remove both requests from queue
        await Promise.all([
          this.queueManager.dequeue(request.id),
          this.queueManager.dequeue(match.id),
        ]);

        Logger.info(`Match found in ${matchTime}ms: ${request.channelId} <-> ${match.channelId}`);

        // Emit match event
        this.emit('call:matched', { call: activeCall, matchTime });

        return {
          matched: true,
          callId: activeCall.id,
          participants: activeCall.participants,
          matchTime,
        };
      }

      return { matched: false };
    }
    catch (error) {
      Logger.error(`Error finding match for request ${request.id}:`, error);
      return { matched: false };
    }
  }

  /**
   * Get current matching statistics
   */
  async getMatchingStats(): Promise<{
    averageMatchTime: number;
    successRate: number;
    queueLength: number;
  }> {
    const queueLength = await this.queueManager.getQueueLength();
    const averageMatchTime =
      this.matchingTimes.length > 0
        ? this.matchingTimes.reduce((a, b) => a + b, 0) / this.matchingTimes.length
        : 0;
    const successRate = this.totalAttempts > 0 ? this.successfulMatches / this.totalAttempts : 0;

    return {
      averageMatchTime,
      successRate,
      queueLength,
    };
  }

  /**
   * Start matching process - simplified
   */
  private startMatching(): void {
    if (this.matchingInterval) {
      return;
    }

    Logger.info(`Starting matching process on cluster ${this.clusterId}`);

    this.matchingInterval = setInterval(async () => {
      // Only process if we're the queue leader
      if (this.queueManager.isQueueLeader()) {
        try {
          await this.processQueue();
        }
        catch (error) {
          Logger.error('Error in matching process:', error);
        }
      }
    }, this.intervalMs);

    // Initial queue processing
    if (this.queueManager.isQueueLeader()) {
      this.processQueue();
    }
  }

  /**
   * Process the queue for matches - simplified
   */
  private async processQueue(): Promise<void> {
    const startTime = Date.now();

    try {
      const pendingRequests = await this.queueManager.getPendingRequests();

      if (pendingRequests.length < 2) {
        return; // Need at least 2 requests to match
      }

      Logger.debug(`Processing queue with ${pendingRequests.length} requests`);

      let matchesFound = 0;
      const processed = new Set<string>();

      // Process requests in pairs
      for (let i = 0; i < pendingRequests.length; i++) {
        const request1 = pendingRequests[i];

        if (processed.has(request1.id)) {
          continue;
        }

        // Find match for this request
        const match = await this.findCompatibleMatch(request1, pendingRequests.slice(i + 1));

        if (match && !processed.has(match.id)) {
          // Create the match
          const result = await this.findMatch(request1);

          if (result.matched) {
            processed.add(request1.id);
            processed.add(match.id);
            matchesFound++;
          }
        }
      }

      const processingTime = Date.now() - startTime;

      if (matchesFound > 0) {
        Logger.info(
          `Queue processing completed: ${matchesFound} matches found in ${processingTime}ms`,
        );
      }
    }
    catch (error) {
      Logger.error('Error processing queue:', error);
    }
  }

  /**
   * Find a compatible match - simplified
   */
  private async findCompatibleMatch(
    request: CallRequest,
    candidates: CallRequest[],
  ): Promise<CallRequest | null> {
    for (const candidate of candidates) {
      // Skip self
      if (candidate.id === request.id) {
        continue;
      }

      // Check compatibility rules
      if (await this.areCompatible(request, candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Check if two requests are compatible - simplified
   */
  private async areCompatible(request1: CallRequest, request2: CallRequest): Promise<boolean> {
    // Rule 1: Different servers
    if (request1.guildId === request2.guildId) {
      return false;
    }

    // Rule 2: Different initiators
    if (request1.initiatorId === request2.initiatorId) {
      return false;
    }

    // Rule 3: Check recent matches
    const hasRecentMatch = await this.cacheManager.hasRecentMatch(
      request1.initiatorId,
      request2.initiatorId,
    );

    if (hasRecentMatch) {
      return false;
    }

    // Rule 4: Age compatibility - simplified
    const ageDifference = Math.abs(request1.timestamp - request2.timestamp);
    const maxAgeDifference = 5 * 60 * 1000; // 5 minutes

    if (ageDifference > maxAgeDifference) {
      // Allow older requests to match with anyone after 10 minutes
      const oldestTime = Math.min(request1.timestamp, request2.timestamp);
      const age = Date.now() - oldestTime;

      if (age < 10 * 60 * 1000) {
        return false;
      }
    }

    return true;
  }

  /**
   * Create active call
   */
  private async createActiveCall(
    request1: CallRequest,
    request2: CallRequest,
  ): Promise<ActiveCall> {
    const callId = this.generateCallId();
    const startTime = new Date();

    const participants: CallParticipant[] = [
      {
        channelId: request1.channelId,
        guildId: request1.guildId,
        webhookUrl: request1.webhookUrl,
        users: new Set([request1.initiatorId]),
        messageCount: 0,
        joinedAt: startTime,
        leftAt: null, // Not left yet
      },
      {
        channelId: request2.channelId,
        guildId: request2.guildId,
        webhookUrl: request2.webhookUrl,
        users: new Set([request2.initiatorId]),
        messageCount: 0,
        joinedAt: startTime,
        leftAt: null, // Not left yet
      },
    ];

    const activeCall: ActiveCall = {
      id: callId,
      participants,
      startTime,
      endTime: null, // Not ended yet
      initiatorId: request1.initiatorId, // Use first initiator
      createdAt: startTime,
      messages: [],
      status: 'ACTIVE',
    };

    // Record recent match
    await this.cacheManager.recordRecentMatch(request1.initiatorId, request2.initiatorId);

    return activeCall;
  }

  /**
   * Generate unique call ID
   */
  private generateCallId(): string {
    return `call_${Date.now()}_${this.clusterId}_${Math.random().toString(36).substring(2, 9)}`;
  }

  async handleEvent(): Promise<void> {
    // Implementation for event handling if needed
  }
}
