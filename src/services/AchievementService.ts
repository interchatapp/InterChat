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

import { type Achievement, type UserAchievement } from '#src/generated/prisma/client/client.js';
import { CacheManager } from '#src/managers/CacheManager.js';
import { ConvertDatesToString } from '#src/types/Utils.js';
import db from '#src/utils/Db.js';
import Logger from '#src/utils/Logger.js';
import getRedis from '#src/utils/Redis.js';
import { handleError } from '#src/utils/Utils.js';
import { RedisKeys } from '#utils/Constants.js';
import { stripIndents } from 'common-tags';
import { type Snowflake, Client, EmbedBuilder } from 'discord.js';

/**
 * Achievement tracking configuration for Redis
 */
export const ACHIEVEMENT_CACHE_TTL = {
  /** TTL for individual achievement data (30 minutes) */
  ACHIEVEMENT: 30 * 60,
  /** TTL for user achievement progress (5 minutes) */
  USER_PROGRESS: 5 * 60,
};

export interface AchievementProgressData {
  userId: string;
  achievementId: string;
  currentValue: number;
  lastUpdated: Date;
}

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  badgeEmoji: string;
  badgeUrl?: string;
  threshold: number;
  secret?: boolean;
}

// Event data interfaces
export interface MessageEventData {
  userId: string;
  hubId?: string;
  serverId?: string;
  broadcastCount?: number;
}

export interface VoteEventData {
  userId: string;
  voteCount: number;
}

export interface HubJoinEventData {
  userId: string;
  hubId: string;
  serverCount?: number;
}

export interface ServerJoinEventData {
  userId: string;
  isAdmin?: boolean;
  hubConnected?: boolean;
}

export interface LanguageChangeEventData {
  userId: string;
  language: string;
}

export interface HelpResponseEventData {
  userId: string;
}

export interface ReactionEventData {
  userId: string;
  serverId: string;
}

export type AchievementEventData =
  | MessageEventData
  | VoteEventData
  | HubJoinEventData
  | ServerJoinEventData
  | LanguageChangeEventData
  | HelpResponseEventData
  | ReactionEventData
  | { userId: string };

/**
 * Service for managing user achievement tracking, progress, and unlocks
 * Optimized for InterChat's 5GB RAM constraint across 9 shards
 */
export class AchievementService {
  private readonly cacheManager: CacheManager;
  private readonly progressCacheManager: CacheManager;

  constructor() {
    this.cacheManager = new CacheManager(getRedis(), {
      prefix: RedisKeys.Achievement,
      expirationMs: ACHIEVEMENT_CACHE_TTL.ACHIEVEMENT * 1000, // 30 minutes
    });

    // Separate cache manager for progress data with shorter TTL
    this.progressCacheManager = new CacheManager(getRedis(), {
      prefix: `${RedisKeys.Achievement}:progress`,
      expirationMs: ACHIEVEMENT_CACHE_TTL.USER_PROGRESS * 1000, // 5 minutes
    });
  }

  private serializeDates(
    achievement: ConvertDatesToString<Achievement> | Achievement,
  ): Achievement {
    return {
      ...achievement,
      createdAt: new Date(achievement.createdAt),
      updatedAt: new Date(achievement.updatedAt),
    };
  }

  /**
   * Retrieves all available achievements from database
   * @returns Array of Achievement objects
   */
  public async getAchievements(): Promise<Achievement[]> {
    const achievements = await this.cacheManager.get<Achievement[]>(
      'all',
      async () => await db.achievement.findMany({ orderBy: { name: 'asc' } }),
    );

    return achievements?.map((achievement) => this.serializeDates(achievement)) ?? [];
  }

  /**
   * Retrieves a specific achievement by ID
   * @param id Achievement ID
   * @returns Achievement object or null
   */
  public async getAchievement(id: string): Promise<Achievement | null> {
    const achievement = await this.cacheManager.get<Achievement>(
      `details:${id}`,
      async () => await db.achievement.findUnique({ where: { id } }),
    );
    return achievement ? this.serializeDates(achievement) : null;
  }

  /**
   * Gets all achievements unlocked by a user
   * @param userId User ID to check
   * @returns Array of UserAchievement objects
   */
  public async getUserAchievements(userId: string): Promise<UserAchievement[]> {
    const userAchievements = await this.cacheManager.get<UserAchievement[]>(
      `user:${userId}:unlocked`,
      async () =>
        await db.userAchievement.findMany({
          where: { userId },
          include: { achievement: true },
          orderBy: { unlockedAt: 'desc' },
        }),
    );

    return (
      userAchievements?.map((userAchievement) => ({
        ...userAchievement,
        unlockedAt: new Date(userAchievement.unlockedAt),
      })) ?? []
    );
  }

  /**
   * Gets user's progress towards a specific achievement
   * @param userId User ID to check
   * @param achievementId Achievement ID to check progress for
   * @returns Current progress value or 0 if not started
   */
  public async getProgress(userId: string, achievementId: string): Promise<number> {
    const key = `${userId}:${achievementId}`;
    const progress = await this.progressCacheManager.get<AchievementProgressData>(key, async () => {
      const stored = await db.userAchievementProgress.findUnique({
        where: { userId_achievementId: { userId, achievementId } },
      });

      if (!stored) return null;

      return {
        userId,
        achievementId,
        currentValue: stored.currentValue,
        lastUpdated: stored.updatedAt,
      };
    });

    return progress?.currentValue ?? 0;
  }

  /**
   * Invalidate all caches related to a user's achievements
   * Used for cross-shard cache invalidation
   */
  public async invalidateUserCaches(userId: string): Promise<void> {
    const redis = getRedis();

    // Use SCAN instead of KEYS for better performance
    const patterns = [
      `${RedisKeys.Achievement}:user:${userId}:*`,
      `${RedisKeys.Achievement}:progress:${userId}:*`,
    ];

    for (const pattern of patterns) {
      const stream = redis.scanStream({ match: pattern, count: 100 });
      const keys: string[] = [];

      stream.on('data', (resultKeys: string[]) => {
        keys.push(...resultKeys);
      });

      await new Promise<void>((resolve) => {
        stream.on('end', async () => {
          if (keys.length > 0) {
            await redis.del(...keys);
          }
          resolve();
        });
      });
    }
  }

  /**
   * Updates progress towards an achievement
   * @param userId User ID to update progress for
   * @param achievementId Achievement ID to update progress for
   * @param value Value to set (or increment if increment=true)
   * @param increment Whether to add to current value (true) or set directly (false)
   * @returns The new progress value after update
   */
  public async updateProgress(
    userId: string,
    achievementId: string,
    value: number,
    increment = true,
  ): Promise<number> {
    try {
      // First check if the achievement is already unlocked
      const unlocked = await this.isAchievementUnlocked(userId, achievementId);
      if (unlocked) return -1; // Already unlocked, no need to update progress

      const achievement = await this.getAchievement(achievementId);
      if (!achievement) {
        Logger.error(`Attempted to update progress for non-existent achievement: ${achievementId}`);
        return 0;
      }

      // Get current progress
      const currentProgress = await this.getProgress(userId, achievementId);

      // Calculate new progress value
      const newValue = increment ? currentProgress + value : value;

      // Update or insert the progress record
      await db.userAchievementProgress.upsert({
        where: {
          userId_achievementId: { userId, achievementId },
        },
        create: {
          userId,
          achievementId,
          currentValue: newValue,
        },
        update: {
          currentValue: newValue,
          updatedAt: new Date(),
        },
      });

      // Update progress cache
      await this.progressCacheManager.set(
        `${userId}:${achievementId}`,
        {
          userId,
          achievementId,
          currentValue: newValue,
          lastUpdated: new Date(),
        },
        ACHIEVEMENT_CACHE_TTL.USER_PROGRESS,
      );

      // Check if achievement should be unlocked (only if we haven't already checked recently)
      if (newValue >= achievement.threshold) {
        // Use a separate cache key to prevent duplicate unlock attempts
        const unlockKey = `unlock_check:${userId}:${achievementId}`;
        const recentlyChecked = await this.cacheManager.get<boolean>(unlockKey);

        if (!recentlyChecked) {
          await this.cacheManager.set(unlockKey, true, 60); // Cache for 1 minute
          await this.unlockAchievement(userId, achievementId);
        }
      }

      return newValue;
    }
    catch (error) {
      handleError(error, {
        comment: `Failed to update achievement progress: ${achievementId} for user: ${userId}`,
      });
      return 0;
    }
  }

  /**
   * Increment progress towards an achievement by 1
   * @param userId User ID to update
   * @param achievementId Achievement ID to increment
   * @returns New progress value
   */
  public async incrementProgress(userId: string, achievementId: string): Promise<number> {
    return await this.updateProgress(userId, achievementId, 1, true);
  }

  /**
   * Checks if a user has unlocked a specific achievement
   * @param userId User ID to check
   * @param achievementId Achievement ID to check
   * @returns True if unlocked, false otherwise
   */
  public async isAchievementUnlocked(userId: string, achievementId: string): Promise<boolean> {
    const unlocked = await this.cacheManager.get<boolean>(
      `user:${userId}:has:${achievementId}`,
      async () => {
        const record = await db.userAchievement.findUnique({
          where: { userId_achievementId: { userId, achievementId } },
        });
        return !!record;
      },
    );

    return unlocked ?? false;
  }

  /**
   * Unlocks an achievement for a user and sends a notification
   * @param userId User ID to unlock for
   * @param achievementId Achievement ID to unlock
   * @param client Discord client for sending notifications
   * @returns The unlocked user achievement or null
   */
  public async unlockAchievement(
    userId: string,
    achievementId: string,
    client?: Client,
  ): Promise<UserAchievement | null> {
    try {
      // Check if already unlocked
      const isUnlocked = await this.isAchievementUnlocked(userId, achievementId);
      if (isUnlocked) return null;

      const achievement = await this.getAchievement(achievementId);
      if (!achievement) {
        Logger.error(`Attempted to unlock non-existent achievement: ${achievementId}`);
        return null;
      }

      // Create the user achievement record
      const userAchievement = await db.userAchievement.create({
        data: {
          userId,
          achievementId,
          unlockedAt: new Date(),
        },
        include: {
          achievement: true,
        },
      });

      // Update caches
      await this.cacheManager.set(`user:${userId}:has:${achievementId}`, true);

      // Invalidate all user caches across shards
      await this.invalidateUserCaches(userId);

      // Send notification if client is provided
      if (client) {
        await this.sendAchievementNotification(userId, achievement, client);
      }

      // Check for InterCompletionist achievement
      await this.checkForCompletionist(userId, client);

      return userAchievement;
    }
    catch (error) {
      handleError(error, {
        comment: `Failed to unlock achievement: ${achievementId} for user: ${userId}`,
      });
      return null;
    }
  }

  /**
   * Sends a DM notification to the user about unlocking an achievement
   */
  private async sendAchievementNotification(
    userId: Snowflake,
    achievement: Achievement,
    client: Client,
  ): Promise<void> {
    try {
      const user = await client.users.fetch(userId).catch(() => null);
      if (!user) return;

      // Get user's total achievement count for the notification
      const userAchievements = await this.getUserAchievements(userId);
      const totalUnlocked = userAchievements.length;
      const allAchievements = await this.getAchievements();
      const totalAchievements = allAchievements.length;

      const embed = new EmbedBuilder()
        .setTitle('🏆 Achievement Unlocked!')
        .setDescription(
          stripIndents`**${achievement.badgeEmoji} ${achievement.name}**\n
          ${achievement.description}\n\n
          **Progress:** ${totalUnlocked}/${totalAchievements} achievements unlocked`,
        )
        .setColor('#FFD700')
        .setThumbnail(achievement.badgeUrl ?? 'https://i.imgur.com/NKKmav5.gif')
        .setFooter({
          text: 'InterChat Achievements • Use /achievements to view all',
          iconURL: client.user?.displayAvatarURL(),
        })
        .setTimestamp();

      // Add a special message for milestone achievements
      if (totalUnlocked === 1) {
        embed.setDescription(
          `${embed.data.description}\n\n🎉 **Congratulations on your first achievement!**`,
        );
      }
      else if (totalUnlocked === Math.floor(totalAchievements / 2)) {
        embed.setDescription(`${embed.data.description}\n\n🌟 **Halfway there! Keep going!**`);
      }
      else if (totalUnlocked === totalAchievements) {
        embed.setDescription(
          `${embed.data.description}\n\n👑 **Achievement Master! You've unlocked everything!**`,
        );
      }

      await user.send({ embeds: [embed] }).catch(() => {
        // User might have DMs disabled - we can ignore this error
      });
    }
    catch (error) {
      handleError(error, {
        comment: `Failed to send achievement notification for: ${achievement.id} to user: ${userId}`,
      });
    }
  }

  /**
   * Checks if the user has unlocked all other achievements to award InterCompletionist
   */
  private async checkForCompletionist(userId: string, client?: Client): Promise<void> {
    try {
      // Don't check for the InterCompletionist itself to avoid infinite recursion
      const allAchievements = await db.achievement.findMany({
        where: { id: { not: 'intercompletionist' } },
      });

      const userAchievements = await db.userAchievement.findMany({
        where: { userId },
        select: { achievementId: true },
      });

      const unlockedIds = new Set(userAchievements.map((ua) => ua.achievementId));

      // Check if user has unlocked all achievements except InterCompletionist
      const hasAllAchievements = allAchievements.every((a) => unlockedIds.has(a.id));

      if (hasAllAchievements) {
        await this.unlockAchievement(userId, 'intercompletionist', client);
      }
    }
    catch (error) {
      handleError(error, {
        comment: `Failed to check for completionist achievement for user: ${userId}`,
      });
    }
  }

  /**
   * Process message-related achievements
   * @param userId User ID
   * @param data Event data
   * @param client Discord client
   */
  private async processMessageAchievements(
    userId: string,
    data: MessageEventData,
    client?: Client,
  ): Promise<void> {
    // First Steps (first message ever)
    await this.trackFirstMessage(userId, client);

    // Global Chatter (message in a hub)
    if (data.hubId) {
      await this.incrementProgress(userId, 'global-chatter');
    }

    // Message Marathoner (any message)
    await this.incrementProgress(userId, 'message-marathoner');

    // Streak Master (messages on consecutive days)
    await this.processMessageStreak(userId);

    // World Tour (check unique servers)
    if (data.serverId) {
      await this.processWorldTour(userId, data.serverId);
    }

    // Echo Chamber (check broadcast count)
    if (data.broadcastCount && data.broadcastCount >= 10) {
      await this.unlockAchievement(userId, 'echo-chamber', client);
    }

    // FIXME: Time-based achievements (Night Owl, Early Bird) (Currently disabled, because timezones)
    // await this.trackTimeBasedAchievements(userId, client);

    // Golden Webhook (active during anniversary month)
    await this.trackAnniversaryActivity(userId, client);
  }

  /**
   * Process vote-related achievements
   * @param userId User ID
   * @param data Event data
   * @param client Discord client
   */
  private async processVoteAchievements(
    userId: string,
    data: VoteEventData,
    client?: Client,
  ): Promise<void> {
    const voteCount = data.voteCount || 0;

    // Voter achievement (10 votes)
    if (voteCount >= 10) {
      await this.unlockAchievement(userId, 'voter', client);
    }

    // Super Voter achievement (100 votes)
    if (voteCount >= 100) {
      await this.unlockAchievement(userId, 'super-voter', client);
    }
  }

  /**
   * Process hub join-related achievements
   * @param userId User ID
   * @param data Event data
   * @param client Discord client
   */
  private async processHubJoinAchievements(
    userId: string,
    data: HubJoinEventData,
    client?: Client,
  ): Promise<void> {
    // Hub Hopper (joining multiple hubs)
    await this.processHubJoin(userId, data.hubId);

    // Interconnected (joining a hub with 10+ servers)
    if (data.serverCount && data.serverCount >= 10) {
      await this.unlockAchievement(userId, 'interconnected', client);
    }
  }

  /**
   * Process server join-related achievements
   * @param userId User ID
   * @param data Event data
   * @param client Discord client
   */
  private async processServerJoinAchievements(
    userId: string,
    data: ServerJoinEventData,
    client?: Client,
  ): Promise<void> {
    // Bridge Builder (if user is admin and connected to a hub)
    if (data.isAdmin && data.hubConnected) {
      await this.unlockAchievement(userId, 'bridge-builder', client);
    }
  }

  /**
   * Mass update achievement progress for related activities
   * For example, when a user sends a message, check various message-related achievements
   * @param eventType The type of event to process
   * @param data Event-specific data
   * @param client Discord client for notifications
   */
  public async processEvent(
    eventType:
      | 'message'
      | 'vote'
      | 'hub_join'
      | 'hub_create'
      | 'reaction'
      | 'serverJoin'
      | 'language_change',
    data: AchievementEventData,
    client?: Client,
  ): Promise<void> {
    try {
      const { userId } = data;
      if (!userId) return;

      switch (eventType) {
        case 'message':
          await this.processMessageAchievements(userId, data as MessageEventData, client);
          break;

        case 'vote':
          await this.processVoteAchievements(userId, data as VoteEventData, client);
          break;

        case 'hub_create':
          // Hub Creator achievement
          await this.unlockAchievement(userId, 'hub-creator', client);
          break;

        case 'hub_join':
          await this.processHubJoinAchievements(userId, data as HubJoinEventData, client);
          break;

        case 'reaction':
          if ('serverId' in data && data.serverId) {
            // Cross-Cultural Ambassador (reactions from different servers)
            await this.processCrossCulturalReaction(userId, data.serverId);
          }
          break;

        case 'serverJoin':
          await this.processServerJoinAchievements(userId, data as ServerJoinEventData, client);
          break;

        case 'language_change':
          if ('language' in data) {
            // Polyglot (using the bot in 3+ languages)
            await this.trackLanguageUsage(userId, data.language, client);
          }
          break;
      }
    }
    catch (error) {
      handleError(error, {
        comment: `Failed to process achievement event: ${eventType} for data: ${JSON.stringify(data)}`,
      });
    }
  }

  /**
   * Tracks the unique servers a user has sent messages in
   */
  private async processWorldTour(userId: string, serverId: string): Promise<void> {
    const key = `user:${userId}:servers`;

    // Add server to user's set of visited servers
    await this.cacheManager.addSetMember(key, serverId);

    // Get the count of unique servers
    const servers = await this.cacheManager.getSetMembers<string>(key);

    if (servers.length >= 10) {
      await this.unlockAchievement(userId, 'world-tour');
    }
  }

  /**
   * Tracks the unique hubs a user has joined
   */
  private async processHubJoin(userId: string, hubId: string): Promise<void> {
    const key = `user:${userId}:hubs`;

    // Add hub to user's set of joined hubs
    await this.cacheManager.addSetMember(key, hubId);

    // Get the count of unique hubs
    const hubs = await this.cacheManager.getSetMembers<string>(key);

    if (hubs.length >= 3) {
      await this.unlockAchievement(userId, 'hub-hopper');
    }
  }

  /**
   * Tracks the user's message streak (consecutive days)
   */
  private async processMessageStreak(userId: string): Promise<void> {
    const key = `user:${userId}:streak`;

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day

    const streakData = await this.cacheManager.get<{
      lastMessageDate: string;
      currentStreak: number;
      longestStreak: number;
    }>(key);

    const lastMessageDate = streakData?.lastMessageDate
      ? new Date(streakData.lastMessageDate)
      : null;

    let { currentStreak = 0, longestStreak = 0 } = streakData || {};

    if (!lastMessageDate) {
      // First message
      currentStreak = 1;
      longestStreak = 1;
    }
    else {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const lastMessageDay = new Date(lastMessageDate);
      lastMessageDay.setHours(0, 0, 0, 0);

      if (lastMessageDay.getTime() === today.getTime()) {
        // Already messaged today, no streak change
      }
      else if (lastMessageDay.getTime() === yesterday.getTime()) {
        // Messaged yesterday, streak continues
        currentStreak += 1;
        longestStreak = Math.max(longestStreak, currentStreak);
      }
      else {
        // Missed a day, streak resets
        currentStreak = 1;
      }
    }

    // Save updated streak data
    await this.cacheManager.set(key, {
      lastMessageDate: today.toISOString(),
      currentStreak,
      longestStreak,
    });

    // Check for Streak Master (30 days)
    if (currentStreak >= 30) {
      await this.unlockAchievement(userId, 'streak-master');
    }
  }

  /**
   * Tracks reactions received from unique servers
   */
  private async processCrossCulturalReaction(userId: string, serverId: string): Promise<void> {
    const key = `user:${userId}:reaction_servers`;

    // Add server to the set of servers that reacted to this user
    await this.cacheManager.addSetMember(key, serverId);

    // Get the count of unique servers
    const servers = await this.cacheManager.getSetMembers<string>(key);

    if (servers.length >= 5) {
      await this.unlockAchievement(userId, 'cross-cultural-ambassador');
    }
  }

  /**
   * Updates hub server count achievements for the hub owner
   * @param hubId Hub ID to check
   * @param serverCount Current server count
   */
  public async updateHubServerCountAchievements(
    hubId: string,
    serverCount: number,
    client?: Client,
  ): Promise<void> {
    try {
      const hub = await db.hub.findUnique({
        where: { id: hubId },
        select: { ownerId: true },
      });

      if (!hub) return;

      // Viral Hub (25+ servers)
      if (serverCount >= 25) {
        await this.unlockAchievement(hub.ownerId, 'viral-hub', client);
      }

      // Hub Empire (100+ servers)
      if (serverCount >= 100) {
        await this.unlockAchievement(hub.ownerId, 'hub-empire', client);
      }
    }
    catch (error) {
      handleError(error, {
        comment: `Failed to update hub server count achievements for hub: ${hubId}`,
      });
    }
  }

  /**
   * Checks for the pioneer achievement (first 100 users)
   */
  public async checkPioneerAchievement(userId: string): Promise<void> {
    try {
      // Get the total number of users
      const userCount = await db.user.count();

      if (userCount <= 100) {
        await this.unlockAchievement(userId, 'pioneer');
      }
    }
    catch (error) {
      handleError(error, {
        comment: `Failed to check pioneer achievement for user: ${userId}`,
      });
    }
  }

  /**
   * Track replies to user messages from different servers (Social Butterfly)
   */
  public async trackMessageReply(
    originalAuthorId: string,
    replyServerId: string,
    client?: Client,
  ): Promise<void> {
    const key = `user:${originalAuthorId}:reply_servers`;

    // Add server to the set of servers that replied to this user
    await this.cacheManager.addSetMember(key, replyServerId);

    // Get the count of unique servers
    const servers = await this.cacheManager.getSetMembers<string>(key);

    if (servers.length >= 5) {
      await this.unlockAchievement(originalAuthorId, 'social-butterfly', client);
    }
  }

  /**
   * Updates achievements based on chain reaction (multiple servers replying to a thread)
   */
  public async trackChainReaction(
    messageId: string,
    replyServerId: string,
    authorId: string,
    client?: Client,
  ): Promise<void> {
    const key = `message:${messageId}:reply_servers`;

    // Add server to the set of servers that replied to this message
    await this.cacheManager.addSetMember(key, replyServerId);

    // Get the count of unique servers
    const servers = await this.cacheManager.getSetMembers<string>(key);

    if (servers.length >= 10) {
      await this.unlockAchievement(authorId, 'chain-reaction', client);
    }
  }

  /**
   * Track archive exploration (viewing oldest message)
   */
  public async trackArchiveExploration(
    userId: string,
    messageDate: Date,
    hubCreatedDate: Date,
    client?: Client,
  ): Promise<void> {
    // Check if the message is old enough (within first month of hub creation)
    const oneMonthAfterCreation = new Date(hubCreatedDate);
    oneMonthAfterCreation.setMonth(oneMonthAfterCreation.getMonth() + 1);

    if (messageDate <= oneMonthAfterCreation) {
      await this.unlockAchievement(userId, 'archive-explorer', client);
    }
  }

  /**
   * Track language usage for Polyglot achievement
   * @param userId User ID to track
   * @param language Language code being used
   * @param client Discord client for notifications
   */
  public async trackLanguageUsage(
    userId: string,
    language: string,
    client?: Client,
  ): Promise<void> {
    try {
      const key = `user:${userId}:languages`;

      // Add language to the set of languages used by this user
      await this.cacheManager.addSetMember(key, language);

      // Get the count of unique languages
      const languages = await this.cacheManager.getSetMembers<string>(key);

      if (languages.length >= 3) {
        await this.unlockAchievement(userId, 'polyglot', client);
      }
    }
    catch (error) {
      handleError(error, {
        comment: `Failed to track language usage for user: ${userId}, language: ${language}`,
      });
    }
  }

  /**
   * Track Golden Webhook achievement (active during anniversary month)
   * @param userId User ID to track
   * @param client Discord client for notifications
   */
  public async trackAnniversaryActivity(userId: string, client?: Client): Promise<void> {
    try {
      const currentMonth = new Date().getMonth();
      const anniversaryMonth = 4; // May (0-indexed, so 4 = May)

      if (currentMonth === anniversaryMonth) {
        await this.unlockAchievement(userId, 'golden-webhook', client);
      }
    }
    catch (error) {
      handleError(error, {
        comment: `Failed to track anniversary activity for user: ${userId}`,
      });
    }
  }

  /**
   * Track first message achievement
   * @param userId User ID to track
   * @param client Discord client for notifications
   */
  public async trackFirstMessage(
    userId: string,
    client?: Client,
  ): Promise<void> {
    try {
      // Check if user has already sent a message (has any progress on message-marathoner)
      const messageCount = await this.getProgress(userId, 'message-marathoner');

      if (messageCount === 1) {
        // This is their first message
        await this.unlockAchievement(userId, 'first-steps', client);
      }
    }
    catch (error) {
      handleError(error, {
        comment: `Failed to track first message for user: ${userId}`,
      });
    }
  }

  /**
   * Track time-based achievements (Night Owl, Early Bird)
   * @param userId User ID to track
   * @param client Discord client for notifications
   */
  public async trackTimeBasedAchievements(
    userId: string,
    client?: Client,
  ): Promise<void> {
    try {
      const now = new Date();
      const hour = now.getHours();

      // Night Owl (2-4 AM)
      if (hour >= 2 && hour < 4) {
        await this.unlockAchievement(userId, 'night-owl', client);
      }

      // Early Bird (5-7 AM)
      if (hour >= 5 && hour < 7) {
        await this.unlockAchievement(userId, 'early-bird', client);
      }
    }
    catch (error) {
      handleError(error, {
        comment: `Failed to track time-based achievements for user: ${userId}`,
      });
    }
  }

  /**
   * Track help responses for Hub Hero achievement
   * @param userId User ID to track
   * @param client Discord client for notifications
   */
  public async trackHelpResponse(userId: string, client?: Client): Promise<void> {
    try {
      await this.incrementProgress(userId, 'hub-hero');

      // Check if the user has reached the threshold
      const progress = await this.getProgress(userId, 'hub-hero');
      if (progress >= 50) {
        await this.unlockAchievement(userId, 'hub-hero', client);
      }
    }
    catch (error) {
      handleError(error, {
        comment: `Failed to track help response for user: ${userId}`,
      });
    }
  }
}

export default AchievementService;
