import type { Client } from 'discord.js';
import { getEmoji } from '#utils/EmojiUtils.js';
import { checkIfStaff } from '#utils/Utils.js';
import Constants from '#utils/Constants.js';
import db from '#src/utils/Db.js';
import { User } from '@prisma/client';

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

export function getExtraBadges(
  userId: string,
  client: Client,
  opts: { userData?: User | null },
): Badge[] {
  const badges: Badge[] = [];

  const timeSinceVote = Date.now() - (opts.userData?.lastVoted?.getTime() ?? 0);
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

export async function getVisibleBadges(
  userId: string,
  client: Client,
  userData?: User | null,
): Promise<string> {
  const shouldShow = await shouldShowBadges(userId, userData);
  if (shouldShow === false) return '';

  return [...getBadges(userId, client), ...getExtraBadges(userId, client, { userData })]
    .map((badge) => badge.emoji)
    .join(' ');
}
