import type { Client } from 'discord.js';
import { getEmoji } from '#utils/EmojiUtils.js';
import { checkIfStaff } from '#utils/Utils.js';
import Constants from '#utils/Constants.js';

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

export function formatBadges(badges: Badge[]): string {
  return badges.map((badge) => badge.emoji).join(' ');
}
