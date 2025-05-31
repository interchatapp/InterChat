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
import getRedis from '#src/utils/Redis.js';
import { handleError } from '#src/utils/Utils.js';
import type { Snowflake } from 'discord.js';

export interface VotingStreak {
  current: number;
  longest: number;
  lastVoteDate: Date | null;
}

export async function updateVotingStreak(
  userId: Snowflake,
  lastVoted: Date,
): Promise<VotingStreak> {
  try {
    const redis = getRedis();
    const streakKey = `voting:streak:${userId}`;

    // Get current streak from Redis cache
    const cachedStreak = await redis.get(streakKey);
    const currentStreak = cachedStreak ? parseInt(cachedStreak, 10) : 0;

    // Calculate new streak
    const newStreak = currentStreak + 1;

    // Update Redis cache
    await redis.setex(streakKey, 3600, newStreak.toString());

    // Update longest streak if necessary
    const longestStreak = Math.max(newStreak, currentStreak);

    return {
      current: newStreak,
      longest: longestStreak,
      lastVoteDate: lastVoted,
    };
  }
  catch (error) {
    handleError(error, { comment: 'Error updating voting streak:' });
    return {
      current: 0,
      longest: 0,
      lastVoteDate: null,
    };
  }
}

/**
 * Get the user's current voting streak
 */
export async function getVotingStreak(userId: Snowflake): Promise<number> {
  try {
    const redis = getRedis();
    const streakKey = `voting:streak:${userId}`;

    // Get current streak from Redis cache
    const cachedStreak = await redis.get(streakKey);
    if (cachedStreak) {
      return parseInt(cachedStreak, 10);
    }

    // Calculate streak from database if not cached
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { lastVoted: true, voteCount: true },
    });

    if (!user?.lastVoted) return 0;

    // Simple streak calculation - can be enhanced with more complex logic
    const daysSinceLastVote = Math.floor(
      (Date.now() - user.lastVoted.getTime()) / (1000 * 60 * 60 * 24),
    );

    // If voted within last 2 days, consider streak active
    const currentStreak = daysSinceLastVote <= 1 ? Math.min(user.voteCount, 365) : 0;

    // Cache the result for 1 hour
    await redis.setex(streakKey, 3600, currentStreak.toString());

    return currentStreak;
  }
  catch (error) {
    handleError(error, { comment: 'Error getting voting streak:' });
    return 0;
  }
}

/**
 * Get the user's position on the voting leaderboard
 */
export async function getVotingLeaderboard(userId: Snowflake): Promise<number> {
  try {
    const redis = getRedis();
    const leaderboardKey = 'voting:leaderboard:monthly';

    // Get user's rank from Redis sorted set
    const rank = await redis.zrevrank(leaderboardKey, userId);

    // If not in Redis, calculate from database
    if (rank === null) {
      const usersWithMoreVotes = await db.user.count({
        where: {
          voteCount: {
            gt: await db.user
              .findUnique({
                where: { id: userId },
                select: { voteCount: true },
              })
              .then((user) => user?.voteCount ?? 0),
          },
        },
      });

      return usersWithMoreVotes + 1;
    }

    return rank + 1; // Redis rank is 0-based, we want 1-based
  }
  catch (error) {
    handleError(error, { comment: 'Error getting voting leaderboard position:' });
    return 0;
  }
}

/**
 * Update voting leaderboard when user votes
 */
export async function updateVotingLeaderboard(
  userId: Snowflake,
  newVoteCount: number,
): Promise<void> {
  try {
    const redis = getRedis();
    const leaderboardKey = 'voting:leaderboard:monthly';

    // Update user's score in the sorted set
    await redis.zadd(leaderboardKey, newVoteCount, userId);

    // Set expiry for the leaderboard (reset monthly)
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const secondsUntilNextMonth = Math.floor((nextMonth.getTime() - now.getTime()) / 1000);

    await redis.expire(leaderboardKey, secondsUntilNextMonth);
  }
  catch (error) {
    handleError(error, { comment: 'Error updating voting leaderboard:' });
  }
}

/**
 * Get top voters for leaderboard display
 */
export async function getTopVoters(
  limit: number = 10,
): Promise<Array<{ userId: string; votes: number; rank: number }>> {
  try {
    const redis = getRedis();
    const leaderboardKey = 'voting:leaderboard:monthly';

    // Get top voters from Redis
    const results = await redis.zrevrange(leaderboardKey, 0, limit - 1, 'WITHSCORES');

    const topVoters = [];
    for (let i = 0; i < results.length; i += 2) {
      topVoters.push({
        userId: results[i],
        votes: parseInt(results[i + 1], 10),
        rank: Math.floor(i / 2) + 1,
      });
    }

    return topVoters;
  }
  catch (error) {
    handleError(error, { comment: 'Error getting top voters:' });
    return [];
  }
}
