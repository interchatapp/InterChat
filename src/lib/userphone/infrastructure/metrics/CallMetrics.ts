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

import type { ICallMetrics } from '../../core/interfaces.js';
import { CallEventHandler } from '../../core/events.js';
import Logger from '#src/utils/Logger.js';

/**
 * Simplified high-performance metrics collection
 * Tracks only essential performance indicators
 */
export class CallMetrics extends CallEventHandler implements ICallMetrics {
  private commandTimes: number[] = [];
  private matchingTimes: number[] = [];
  private successfulMatches = 0;
  private totalAttempts = 0;

  // Essential performance targets only
  private readonly targets = {
    commandResponseTime: 1000, // 1 second
    matchingTime: 10000, // 10 seconds
  };

  protected setupEventListeners(): void {
    // Track call lifecycle metrics
    this.subscribe('call:queued', async (_data) => {
      // Queue metrics are tracked in QueueManager
    });

    this.subscribe('call:matched', async (data) => {
      this.recordMatchingTime(data.matchTime);
    });

    this.subscribe('call:started', async (_data) => {
      // Track call start metrics
    });

    this.subscribe('call:ended', async (_data) => {
      // Track call duration and success metrics
    });
  }

  /**
   * Start timing an operation
   */
  startTimer(operation: string): () => void {
    const startTime = Date.now();

    return () => {
      const duration = Date.now() - startTime;

      switch (operation) {
        case 'command':
          this.recordCommandTime('generic', duration);
          break;
        case 'matching':
          this.recordMatchingTime(duration);
          break;
        default:
          Logger.debug(`Timer completed for ${operation}: ${duration}ms`);
      }
    };
  }

  /**
   * Simplified command time recording
   */
  recordCommandTime(_command: string, duration: number): void {
    this.commandTimes.push(duration);

    // Simple SLA check
    if (duration > this.targets.commandResponseTime) {
      Logger.warn(`Command exceeded SLA: ${duration}ms > ${this.targets.commandResponseTime}ms`);
    }

    // Keep only last 100 measurements (reduced for performance)
    if (this.commandTimes.length > 100) {
      this.commandTimes.splice(0, this.commandTimes.length - 100);
    }
  }

  /**
   * Simplified matching time recording
   */
  recordMatchingTime(duration: number): void {
    this.matchingTimes.push(duration);
    this.totalAttempts++;

    // Simple SLA check
    if (duration <= this.targets.matchingTime) {
      this.successfulMatches++;
    }
    else {
      Logger.warn(`Matching exceeded SLA: ${duration}ms > ${this.targets.matchingTime}ms`);
    }

    // Keep only last 100 measurements (reduced for performance)
    if (this.matchingTimes.length > 100) {
      this.matchingTimes.splice(0, this.matchingTimes.length - 100);
    }
  }

  /**
   * Simplified performance statistics
   */
  async getStats(): Promise<{
    averageCommandTime: number;
    averageMatchingTime: number;
    matchingSuccessRate: number;
  }> {
    const averageCommandTime = this.calculateAverage(this.commandTimes);
    const averageMatchingTime = this.calculateAverage(this.matchingTimes);
    const matchingSuccessRate =
      this.totalAttempts > 0 ? this.successfulMatches / this.totalAttempts : 1;

    return {
      averageCommandTime,
      averageMatchingTime,
      matchingSuccessRate,
    };
  }

  async getDetailedReport(): Promise<{
    commandMetrics: { average: number };
    matchingMetrics: { average: number; successRate: number };
  }> {
    return {
      commandMetrics: {
        average: this.calculateAverage(this.commandTimes),
      },
      matchingMetrics: {
        average: this.calculateAverage(this.matchingTimes),
        successRate: this.totalAttempts > 0 ? this.successfulMatches / this.totalAttempts : 1,
      },
    };
  }

  /**
   * Essential helper methods only
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  async handleEvent(): Promise<void> {
    // Implementation for event handling if needed
  }
}
