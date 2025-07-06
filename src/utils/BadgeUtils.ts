import { Badges, User } from '#src/generated/prisma/client/client.js';
import { getRedis } from '#src/utils/Redis.js';
import { RedisKeys } from '#utils/Constants.js';
import { getEmoji } from '#utils/EmojiUtils.js';
import type { Client } from 'discord.js';

export interface FormattedBadge {
  id: string;
  emoji: string;
  name: string;
  description: string;
}

type PartialUser = Partial<User> & {
  badges: Badges[];
  id: string;
  showBadges?: boolean;
};

export function getBadges(user: PartialUser, client: Client): FormattedBadge[] {
  // Developer Badge
  const badges: (FormattedBadge | null)[] = user.badges.map((badge) => {
    switch (badge) {
      case Badges.SUPPORTER:
        return {
          id: 'supporter',
          emoji: getEmoji('donator_badge', client),
          name: 'Supporter',
          description: 'Supports InterChat with a monthly donation',
        };
      case Badges.TRANSLATOR:
        return {
          id: 'translator',
          emoji: getEmoji('translator_badge', client),
          name: 'Translator',
          description: 'Helped translate InterChat into another language',
        };
      case Badges.DEVELOPER:
        return {
          id: 'developer',
          emoji: getEmoji('developer_badge', client),
          name: 'Developer',
          description: 'Contributed to the InterChat codebase',
        };
      case Badges.STAFF:
        return {
          id: 'staff',
          emoji: getEmoji('staff_badge', client),
          name: 'Staff',
          description: 'InterChat staff member',
        };
      case Badges.BETA_TESTER:
        return {
          id: 'beta_tester',
          emoji: getEmoji('beta_tester_badge', client),
          name: 'Beta Tester',
          description: 'Participated in InterChat beta testing',
        };
      default:
        return null;
    }
  });

  return badges.filter((badge): badge is FormattedBadge => badge !== null);
}

export function formatBadges(badges: FormattedBadge[]): string {
  return badges.map((badge) => badge.emoji).join(' ');
}

export async function shouldShowBadgesForMessage(
  user: PartialUser,
  hubId: string,
): Promise<boolean> {
  // First check if user wants to show badges at all
  const showBadges = user?.showBadges;
  if (!showBadges) return false;

  const redis = getRedis();
  const key = `${RedisKeys.LastHubMessageUser}:${hubId}`;

  const lastUserId = await redis.get(key);

  // Store current user as the last message sender (expire after 1 minute to clean up)
  redis.set(key, user.id, 'EX', 60).catch(() => null);

  // Show badges only if this is a different user than the last message
  return lastUserId !== user.id;
}

export async function getVisibleBadges(
  userData: PartialUser,
  client: Client,
  hubId: string,
): Promise<string> {
  const shouldShow = await shouldShowBadgesForMessage(userData, hubId);
  if (!shouldShow) return '';
  const badges = getBadges(userData, client);

  return badges.map((badge) => badge.emoji).join(' ');
}
