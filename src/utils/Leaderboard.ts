import db from '#src/utils/Db.js';
import getRedis from '#src/utils/Redis.js';
import { Client } from 'discord.js';

/**
 * Generates a Redis key for the leaderboard based on the current year and month.
 * For example: "leaderboard:messages:users:2025-02"
 *
 * @param prefix - The leaderboard prefix (e.g., 'leaderboard:messages:users').
 * @returns A string key that includes the current year and month.
 */
export function getLeaderboardKey(prefix: `leaderboard:messages:${'users' | 'servers'}`): string {
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
  if (type === 'user') await db.userData.upsert(query);
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
function getRankDisplay(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return rank.toString();
}

/**
 * Formats leaderboard data into a table string.
 */
export async function formatUserLeaderboard(
  leaderboardData: string[],
  client: Client,
): Promise<string> {
  // Build header
  let output = '#  | User               | Messages\n';
  output += '---|--------------------|---------\n';

  // Iterate through pairs: [userId, score, ...]
  for (let i = 0; i < leaderboardData.length; i += 2) {
    const rank = i / 2 + 1;
    const userId = leaderboardData[i];
    const score = leaderboardData[i + 1];

    const user = await client.users.fetch(userId).catch(() => ({
      username: 'Unknown',
    }));

    // Limit the username length for table formatting.
    const username =
      user.username.length > 18 ? `${user.username.slice(0, 15)}...` : user.username;

    // Use the helper function to get the rank display value.
    const rankDisplay = getRankDisplay(rank);

    // Pad each column for alignment.
    output += `${rankDisplay.padEnd(2)} | ${username.padEnd(18)} | ${score.toString().padEnd(7)}\n`;
  }

  return `\`\`\`css\n${output}\`\`\``;
}

/**
 * Formats server leaderboard data into a table string.
 * Includes the server name instead of user name and an extra column for server invite link.
 */
export async function formatServerLeaderboard(
  leaderboardData: string[],
  client: Client,
): Promise<string> {
  // Build header with adjusted column widths
  let output = '#  | Server               | Msg | Invite\n';
  output += '---|----------------------|-----|---------------\n';

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

    // Limit the server name length for table formatting.
    const serverName =
    guild.name.length > 20 ? `${guild.name.slice(0, 17)}...` : guild.name;
    const serverData = inviteLinks.find(
      (link) => link.id === serverId && Boolean(link.inviteCode),
    );
    const inviteCode =
      serverData?.inviteCode ?? ('vanityURLCode' in guild ? guild.vanityURLCode : null);
    const invite = inviteCode ? `.gg/${inviteCode}` : 'N/A';

    // Use the helper function to get the rank display value.
    const rankDisplay = getRankDisplay(rank);

    // Pad each column for alignment.
    output += `${rankDisplay.padEnd(2)} | ${serverName.padEnd(20)} | ${score.toString().padEnd(3)} | ${invite.padEnd(15)}\n`;
  }

  return `\`\`\`css\n${output}\`\`\``;
}
