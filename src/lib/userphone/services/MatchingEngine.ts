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

import type { IMatchingEngine, ICacheManager, IQueueManager } from '../core/interfaces.js';
import type { CallRequest, MatchResult, ActiveCall, CallParticipant } from '../core/types.js';
import { CallEventHandler } from '../core/events.js';
import Logger from '#src/utils/Logger.js';

/**
 * High-performance real-time matching engine
 * Processes queue in background with sub-10-second matching times
 */
export class MatchingEngine extends CallEventHandler implements IMatchingEngine {
  private readonly queueManager: IQueueManager;
  private readonly cacheManager: ICacheManager;
  private isRunning = false;
  private matchingInterval: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly maxRecentMatches: number;

  // Performance tracking
  private matchingTimes: number[] = [];
  private successfulMatches = 0;
  private totalAttempts = 0;

  constructor(
    queueManager: IQueueManager,
    cacheManager: ICacheManager,
    intervalMs: number = 1000, // 1 second
    maxRecentMatches: number = 3,
  ) {
    super();
    this.queueManager = queueManager;
    this.cacheManager = cacheManager;
    this.intervalMs = intervalMs;
    this.maxRecentMatches = maxRecentMatches;
  }

  protected setupEventListeners(): void {
    // Listen for new queue entries to trigger immediate matching
    this.subscribe('call:queued', async (data) => {
      // Try immediate match for new request
      await this.tryImmediateMatch(data.request);
    });
  }

  /**
   * Start the background matching process
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      Logger.warn('Matching engine is already running');
      return;
    }

    this.isRunning = true;
    Logger.info(`Starting matching engine with ${this.intervalMs}ms interval`);

    // Start background matching loop
    this.matchingInterval = setInterval(async () => {
      try {
        await this.processQueue();
      }
      catch (error) {
        Logger.error('Error in matching engine background process:', error);
      }
    }, this.intervalMs);

    // Initial queue processing
    await this.processQueue();
  }

  /**
   * Stop the background matching process
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

    Logger.info('Matching engine stopped');
  }

  /**
   * Try to find a match for a specific request
   */
  async findMatch(request: CallRequest): Promise<MatchResult> {
    const startTime = Date.now();
    this.totalAttempts++;

    try {
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
   * Process the entire queue for matches
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
          // Create the match directly (avoid infinite recursion)
          try {
            const matchTime = Date.now() - startTime;
            this.matchingTimes.push(matchTime);
            this.successfulMatches++;

            // Create active call
            const activeCall = await this.createActiveCall(request1, match);

            // Remove both requests from queue
            await Promise.all([
              this.queueManager.dequeue(request1.id),
              this.queueManager.dequeue(match.id),
            ]);

            Logger.info(`Match found in ${matchTime}ms: ${request1.channelId} <-> ${match.channelId}`);

            // Emit match event
            this.emit('call:matched', { call: activeCall, matchTime });

            processed.add(request1.id);
            processed.add(match.id);
            matchesFound++;
          }
          catch (error) {
            Logger.error(`Error creating match between ${request1.id} and ${match.id}:`, error);
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
   * Try immediate match for a new request
   */
  private async tryImmediateMatch(request: CallRequest): Promise<void> {
    try {
      const result = await this.findMatch(request);

      if (result.matched) {
        Logger.info(`Immediate match found for request ${request.id}`);
      }
    }
    catch (error) {
      Logger.error(`Error in immediate match for request ${request.id}:`, error);
    }
  }

  /**
   * Find a compatible match for a request
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
   * Check if two requests are compatible for matching
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

    // Rule 4: Age compatibility (prefer similar queue times)
    const ageDifference = Math.abs(request1.timestamp - request2.timestamp);
    const maxAgeDifference = 5 * 60 * 1000; // 5 minutes

    if (ageDifference > maxAgeDifference) {
      // Allow older requests to match with anyone
      const oldestTime = Math.min(request1.timestamp, request2.timestamp);
      const age = Date.now() - oldestTime;

      if (age < 10 * 60 * 1000) {
        // Less than 10 minutes old
        return false;
      }
    }

    return true;
  }

  /**
   * Create active call from matched requests
   */
  private async createActiveCall(
    request1: CallRequest,
    request2: CallRequest,
  ): Promise<ActiveCall> {
    const callId = this.generateCallId();
    const startTime = Date.now();

    const participants: CallParticipant[] = [
      {
        channelId: request1.channelId,
        guildId: request1.guildId,
        webhookUrl: request1.webhookUrl,
        users: new Set([request1.initiatorId]),
        messageCount: 0,
        joinedAt: startTime,
      },
      {
        channelId: request2.channelId,
        guildId: request2.guildId,
        webhookUrl: request2.webhookUrl,
        users: new Set([request2.initiatorId]),
        messageCount: 0,
        joinedAt: startTime,
      },
    ];

    const activeCall: ActiveCall = {
      id: callId,
      participants,
      startTime,
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
    return `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  async handleEvent(): Promise<void> {
    // Implementation for event handling if needed
  }
}
