import type { Client } from 'discord.js';
import { getEmoji } from '#utils/EmojiUtils.js';
import { checkIfStaff } from '#utils/Utils.js';
import Constants, { RedisKeys } from '#utils/Constants.js';
import db from '#src/utils/Db.js';
import { User } from '#src/generated/prisma/client/client.js';
import { getRedis } from '#src/utils/Redis.js';

export interface Badge {
  id: string;
  emoji: string;
  name: string;
  description: string;
}

export function getBadges(userId: string, client: Client): Badge[] {
  const badges: Badge[] = [];

  // Developer Badge
  if (Constants.DeveloperIds.includes(userId)) {
    badges.push({
      id: 'developer',
      emoji: getEmoji('developer_badge', client),
      name: 'Developer',
      description: 'Core developer of InterChat',
    });
  }

  // Staff Badge
  if (checkIfStaff(userId)) {
    badges.push({
      id: 'staff',
      emoji: getEmoji('staff_badge', client),
      name: 'Staff',
      description: 'InterChat staff member',
    });
  }

  // Translator Badge
  if (Constants.TranslatorIds.includes(userId)) {
    badges.push({
      id: 'translator',
      emoji: getEmoji('translator_badge', client),
      name: 'Translator',
      description: 'Translator of InterChat',
    });
  }

  return badges;
}

export function getVoterBadge(client: Client): Badge {
  return {
    id: 'voter',
    emoji: getEmoji('voter_badge', client),
    name: 'Voter',
    description: 'Voted for InterChat in the last 12 hours',
  };
}

export function getExtraBadges(client: Client, opts: { userData?: User | null }): Badge[] {
  const badges: Badge[] = [];

  if (!opts.userData?.lastVoted) return badges;

  const timeSinceVote = Date.now() - opts.userData.lastVoted.getTime();
  if (timeSinceVote < 12 * 60 * 60 * 1000) {
    badges.push(getVoterBadge(client));
  }

  return badges;
}

export function formatBadges(badges: Badge[]): string {
  return badges.map((badge) => badge.emoji).join(' ');
}

export async function shouldShowBadges(userId: string, userData?: User | null): Promise<boolean> {
  const user =
    userData ?? (await db.user.findUnique({ where: { id: userId }, select: { showBadges: true } }));

  return user?.showBadges ?? true;
}

export async function shouldShowBadgesForMessage(
  userId: string,
  hubId: string,
  userData?: User | null,
): Promise<boolean> {
  // First check if user wants to show badges at all
  const showBadges = await shouldShowBadges(userId, userData);
  if (!showBadges) return false;

  const redis = getRedis();
  const key = `${RedisKeys.LastHubMessageUser}:${hubId}`;

  const lastUserId = await redis.get(key);

  // Store current user as the last message sender (expire after 1 hour to clean up)
  await redis.set(key, userId, 'EX', 3600);

  // Show badges only if this is a different user than the last message
  return lastUserId !== userId;
}

export async function getVisibleBadges(
  userId: string,
  client: Client,
  hubId: string,
  userData?: User | null,
): Promise<string> {
  const shouldShow = await shouldShowBadgesForMessage(userId, hubId, userData);
  if (!shouldShow) return '';

  return [...getBadges(userId, client), ...getExtraBadges(client, { userData })]
    .map((badge) => badge.emoji)
    .join(' ');
}
