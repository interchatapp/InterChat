import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import getRedis from '#src/utils/Redis.js';
import { Client } from 'discord.js';

/**
 * Generates a Redis key for the leaderboard based on the current year and month.
 * For example: "leaderboard:messages:users:2025-02"
 *
 * @param prefix - The leaderboard prefix (e.g., 'leaderboard:messages:users').
 * @returns A string key that includes the current year and month.
 */
export function getLeaderboardKey(
  prefix: `leaderboard:${'messages:users' | 'messages:servers' | 'calls:users' | 'calls:servers'}`,
): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${prefix}:${year}-${month}`;
}

/**
 * Updates the monthly leaderboards for user and server message counts.
 * Also updates persistent user data in MongoDB via db.
 *
 * @param message - The Discord message object.
 */
export async function updateLeaderboards(type: 'user' | 'server', targetId: string): Promise<void> {
  const redis = getRedis();
  const key = getLeaderboardKey(`leaderboard:messages:${type}s`);

  await redis.zincrby(key, 1, targetId);
  await redis.expire(key, 60 * 24 * 60 * 60);

  const query = {
    where: { id: targetId },
    create: { id: targetId, messageCount: 1, lastMessageAt: new Date() },
    update: { messageCount: { increment: 1 }, lastMessageAt: new Date() },
  } as const;

  // Update persistent user data in MongoDB
  if (type === 'user') await db.user.upsert(query);
  else await db.serverData.upsert(query);
}

/**
 * Retrieves the top entries from a specified leaderboard.
 *
 * @param prefix - The leaderboard key prefix.
 * @param limit - The maximum number of entries to retrieve (default is 10).
 * @returns An array containing user/server IDs and their corresponding scores.
 */
export async function getLeaderboard(type: 'user' | 'server', limit = 10): Promise<string[]> {
  const leaderboardKey = getLeaderboardKey(`leaderboard:messages:${type}s`);
  const redis = getRedis();
  const results = await redis.zrevrange(leaderboardKey, 0, limit - 1, 'WITHSCORES');
  return results;
}

/**
 * Retrieves the leaderboard rank for a given user.
 * Redis' zrevrank returns a 0-indexed rank, so we add 1.
 */
export async function getUserLeaderboardRank(userId: string): Promise<number | null> {
  const redis = getRedis();
  const leaderboardKey = getLeaderboardKey('leaderboard:messages:users');
  const rank = await redis.zrevrank(leaderboardKey, userId);
  return rank !== null ? rank + 1 : null;
}

/**
 * Returns the display value for a given rank.
 * Adds medal icons for the top three ranks.
 */
function getRankDisplay(rank: number, dotEmoji: string): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  // use purple emoji for rest
  return `${dotEmoji}`;
}

/**
 * Formats leaderboard data into a table string.
 */
export async function formatUserLeaderboard(
  leaderboardData: string[],
  client: Client,
  type: 'messages' | 'calls' = 'messages',
): Promise<string> {
  let output = '';
  // Iterate through pairs: [userId, score, ...]
  for (let i = 0; i < leaderboardData.length; i += 2) {
    const rank = i / 2 + 1;
    const userId = leaderboardData[i];
    const score = leaderboardData[i + 1];

    const user = await client.users.fetch(userId).catch(() => ({
      username: 'Unknown',
    }));

    // Use the helper function to get the rank display value.
    const rankDisplay = getRankDisplay(rank, getEmoji('dot', client));

    // Pad each column for alignment.
    output += `${rankDisplay} ${`\` ${score} ${type === 'calls' ? 'calls' : 'msgs'} \``} ${user.username}\n`;
  }

  return output;
}

/**
 * Formats server leaderboard data into a table string.
 * Includes the server name instead of user name and an extra column for server invite link.
 */
export async function formatServerLeaderboard(
  leaderboardData: string[],
  client: Client,
  type: 'messages' | 'calls' = 'messages',
): Promise<string> {
  let output = '';
  const inviteLinks = await db.serverData.findMany({
    where: { id: { in: leaderboardData.filter((_, i) => i % 2 === 0) } },
    select: { id: true, inviteCode: true },
  });

  // Iterate through pairs: [serverId, score, ...]
  for (let i = 0; i < leaderboardData.length; i += 2) {
    const rank = i / 2 + 1;
    const serverId = leaderboardData[i];
    const score = leaderboardData[i + 1];

    const guild = (await client.fetchGuild(serverId).catch(() => null)) ?? { name: 'Unknown' };

    const serverData = inviteLinks.find((link) => link.id === serverId && Boolean(link.inviteCode));
    const inviteCode =
      serverData?.inviteCode ?? ('vanityURLCode' in guild ? guild.vanityURLCode : null);
    const invite = inviteCode ? `([join server](https://discord.gg/${inviteCode}))` : '';

    // Use the helper function to get the rank display value.
    const rankDisplay = getRankDisplay(rank, getEmoji('dot', client));

    // Pad each column for alignment.
    output += `${rankDisplay} \` ${score} ${type === 'calls' ? 'calls' : 'msgs'} \` - ${guild.name} ${invite}\n`;
  }

  return output;
}

export async function updateCallLeaderboards(
  type: 'user' | 'server',
  targetId: string,
): Promise<void> {
  const redis = getRedis();
  const key = getLeaderboardKey(`leaderboard:calls:${type}s`);

  await redis.zincrby(key, 1, targetId);
  await redis.expire(key, 30 * 24 * 60 * 60); // 30 days
}

/**
 * Retrieves the top entries from the voting leaderboard.
 *
 * @param limit - The maximum number of entries to retrieve (default is 10).
 * @returns An array containing user IDs and their corresponding vote counts.
 */
export async function getVotingLeaderboard(limit = 10): Promise<string[]> {
  const redis = getRedis();
  const leaderboardKey = 'voting:leaderboard:monthly';

  // Get from Redis first (real-time data)
  const redisResults = await redis.zrevrange(leaderboardKey, 0, limit - 1, 'WITHSCORES');

  if (redisResults.length > 0) {
    return redisResults;
  }

  // Fallback to database if Redis is empty
  const users = await db.user.findMany({
    where: { voteCount: { gt: 0 } },
    orderBy: { voteCount: 'desc' },
    take: limit,
    select: { id: true, voteCount: true },
  });

  // Convert to Redis format: [id, score, id, score, ...]
  const results: string[] = [];
  for (const user of users) {
    results.push(user.id, user.voteCount.toString());
  }

  return results;
}

/**
 * Formats the voting leaderboard for display.
 *
 * @param leaderboard - Array of user IDs and vote counts from getVotingLeaderboard.
 * @param client - Discord client instance for fetching user data.
 * @returns Formatted leaderboard string.
 */
export async function formatVotingLeaderboard(
  leaderboard: string[],
  client: Client,
): Promise<string> {
  if (leaderboard.length === 0) return 'No voting data available.';

  let output = '';

  for (let i = 0; i < leaderboard.length; i += 2) {
    const userId = leaderboard[i];
    const voteCount = parseInt(leaderboard[i + 1], 10);
    const rank = Math.floor(i / 2) + 1;

    // Fetch user data
    const user = await client.users.fetch(userId).catch(() => null);
    const username = user?.username ?? 'Unknown User';

    // Use the helper function to get the rank display value.
    const rankDisplay = getRankDisplay(rank, getEmoji('dot', client));

    // Pad each column for alignment.
    output += `${rankDisplay} \` ${voteCount} votes \` - ${username}\n`;
  }

  return output;
}

export async function getCallLeaderboard(type: 'user' | 'server', limit = 10): Promise<string[]> {
  const leaderboardKey = getLeaderboardKey(`leaderboard:calls:${type}s`);
  const redis = getRedis();
  const results = await redis.zrevrange(leaderboardKey, 0, limit - 1, 'WITHSCORES');
  return results;
}
