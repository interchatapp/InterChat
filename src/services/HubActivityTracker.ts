import type { Snowflake } from 'discord.js';
import db from '#utils/Db.js';
import { getRedis } from '#utils/Redis.js';
import Logger from '#utils/Logger.js';

/**
 * Hub Activity Tracker Service
 * Tracks and updates hub activity metrics for recommendations
 * Addresses user retention by providing accurate activity indicators
 */
export class HubActivityTracker {
  private readonly redis = getRedis();
  private readonly BATCH_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private readonly ACTIVITY_CACHE_TTL = 300; // 5 minutes

  /**
   * Track a message in a hub for activity metrics
   */
  async trackMessage(hubId: string, userId: Snowflake, serverId: string): Promise<void> {
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0]; // YYYY-MM-DD format

      // Update Redis counters for real-time tracking
      const pipeline = this.redis.pipeline();

      // Daily message count
      pipeline.incr(`hub:${hubId}:messages:${today}`);
      pipeline.expire(`hub:${hubId}:messages:${today}`, 86400 * 7); // Keep for 7 days

      // Active users tracking (using sets for uniqueness)
      pipeline.sadd(`hub:${hubId}:active_users:${today}`, userId);
      pipeline.expire(`hub:${hubId}:active_users:${today}`, 86400 * 7);

      // Server activity tracking
      pipeline.sadd(`hub:${hubId}:active_servers:${today}`, serverId);
      pipeline.expire(`hub:${hubId}:active_servers:${today}`, 86400 * 7);

      await pipeline.exec();

      // Update hub's lastActive timestamp
      await db.hub.update({
        where: { id: hubId },
        data: { lastActive: now },
      });
    }
    catch (error) {
      Logger.error('Failed to track hub message activity:', error);
    }
  }

  /**
   * Track a new connection to a hub
   */
  async trackConnection(hubId: string, serverId: string): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0];

      // Track new connections
      await this.redis.sadd(`hub:${hubId}:new_connections:${today}`, serverId);
      await this.redis.expire(`hub:${hubId}:new_connections:${today}`, 86400 * 7);
    }
    catch (error) {
      Logger.error('Failed to track hub connection:', error);
    }
  }

  /**
   * Update hub activity level based on recent metrics
   */
  async updateHubActivityLevel(hubId: string): Promise<void> {
    try {
      const metrics = await this.getHubActivityMetrics(hubId);

      let activityLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

      // Determine activity level based on daily messages and active users
      if (metrics.dailyMessages >= 100 || metrics.dailyActiveUsers >= 20) {
        activityLevel = 'HIGH';
      }
      else if (metrics.dailyMessages >= 20 || metrics.dailyActiveUsers >= 5) {
        activityLevel = 'MEDIUM';
      }

      // Update hub activity level in database
      await db.hub.update({
        where: { id: hubId },
        data: {
          activityLevel,
          weeklyMessageCount: metrics.weeklyMessages,
        },
      });
    }
    catch (error) {
      Logger.error('Failed to update hub activity level:', error);
    }
  }

  /**
   * Get current activity metrics for a hub
   */
  async getHubActivityMetrics(hubId: string): Promise<{
    dailyMessages: number;
    weeklyMessages: number;
    dailyActiveUsers: number;
    weeklyActiveUsers: number;
    dailyActiveServers: number;
    newConnections: number;
  }> {
    const cacheKey = `hub_metrics:${hubId}`;
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const now = new Date();

    // Get metrics for the last 7 days
    const promises = [];
    const dates = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      dates.push(dateStr);

      promises.push(
        this.redis.get(`hub:${hubId}:messages:${dateStr}`),
        this.redis.scard(`hub:${hubId}:active_users:${dateStr}`),
        this.redis.scard(`hub:${hubId}:active_servers:${dateStr}`),
        this.redis.scard(`hub:${hubId}:new_connections:${dateStr}`),
      );
    }

    const results = (await Promise.all(promises)).map(String);

    let dailyMessages = 0;
    let weeklyMessages = 0;
    let dailyActiveUsers = 0;
    let weeklyActiveUsers = 0;
    let dailyActiveServers = 0;
    let newConnections = 0;

    // Process results (4 metrics per day)
    for (let i = 0; i < 7; i++) {
      const dayMessages = parseInt(results[i * 4] || '0', 10);
      const dayUsers = parseInt(results[i * 4 + 1] || '0', 10);
      const dayServers = parseInt(results[i * 4 + 2] || '0', 10);
      const dayConnections = parseInt(results[i * 4 + 3] || '0', 10);

      weeklyMessages += dayMessages;
      weeklyActiveUsers += dayUsers;
      newConnections += dayConnections;

      // Today's metrics
      if (i === 0) {
        dailyMessages = dayMessages;
        dailyActiveUsers = dayUsers;
        dailyActiveServers = dayServers;
      }
    }

    const metrics = {
      dailyMessages,
      weeklyMessages,
      dailyActiveUsers,
      weeklyActiveUsers,
      dailyActiveServers,
      newConnections,
    };

    // Cache for 5 minutes
    await this.redis.setex(cacheKey, this.ACTIVITY_CACHE_TTL, JSON.stringify(metrics));

    return metrics;
  }

  /**
   * Batch update all hub activity metrics (run periodically)
   */
  async batchUpdateAllHubMetrics(): Promise<void> {
    try {
      Logger.info('Starting batch update of hub activity metrics');

      // Get all active hubs (updated in last 7 days)
      const activeHubs = await db.hub.findMany({
        where: {
          lastActive: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
        select: { id: true },
      });

      Logger.info(`Updating metrics for ${activeHubs.length} active hubs`);

      // Update metrics in batches to avoid overwhelming the database
      const batchSize = 10;
      for (let i = 0; i < activeHubs.length; i += batchSize) {
        const batch = activeHubs.slice(i, i + batchSize);

        await Promise.all(batch.map((hub) => this.updateHubActivityLevel(hub.id)));

        // Small delay between batches
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      Logger.info('Completed batch update of hub activity metrics');
    }
    catch (error) {
      Logger.error('Failed to batch update hub metrics:', error);
    }
  }

  /**
   * Calculate hub growth rate based on connection history
   */
  async calculateGrowthRate(hubId: string): Promise<number> {
    try {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      // Get connection counts for current week and previous week
      const [currentWeekConnections, previousWeekConnections] = await Promise.all([
        db.connection.count({
          where: {
            hubId,
            connected: true,
            createdAt: { gte: weekAgo },
          },
        }),
        db.connection.count({
          where: {
            hubId,
            connected: true,
            createdAt: { gte: twoWeeksAgo, lt: weekAgo },
          },
        }),
      ]);

      if (previousWeekConnections === 0) {
        return currentWeekConnections > 0 ? 100 : 0; // 100% growth if starting from 0
      }

      const growthRate =
        ((currentWeekConnections - previousWeekConnections) / previousWeekConnections) * 100;
      return Math.round(growthRate * 100) / 100; // Round to 2 decimal places
    }
    catch (error) {
      Logger.error('Failed to calculate growth rate:', error);
      return 0;
    }
  }

  /**
   * Start periodic batch updates
   */
  startPeriodicUpdates(): void {
    Logger.info('Starting periodic hub activity metric updates');

    // Run immediately
    this.batchUpdateAllHubMetrics();

    // Then run every 5 minutes
    setInterval(() => {
      this.batchUpdateAllHubMetrics();
    }, this.BATCH_UPDATE_INTERVAL);
  }
}

// Export singleton instance
export const hubActivityTracker = new HubActivityTracker();
