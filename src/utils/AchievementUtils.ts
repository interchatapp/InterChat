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

import { type Achievement } from '#src/generated/prisma/client/client.js';
import AchievementService from '#src/services/AchievementService.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type User,
} from 'discord.js';

interface AchievementWithProgress extends Achievement {
  unlocked: boolean;
  progress: number;
  unlockedAt?: Date;
}

/**
 * Creates an embed to display a user's achievements
 * @param user Discord user
 * @param achievements List of achievements with unlock status
 * @param view Current view filter (all, unlocked, locked, progress)
 * @param page Current page number
 * @returns Achievement embed
 */
export async function buildAchievementsEmbed(
  user: User,
  achievements: AchievementWithProgress[],
  view: string = 'all',
  page: number = 1,
): Promise<EmbedBuilder> {
  // Determine title based on view option
  let title = 'All Achievements';
  switch (view) {
    case 'unlocked':
      title = 'Unlocked Achievements';
      break;
    case 'locked':
      title = 'Locked Achievements';
      break;
    case 'progress':
      title = 'Achievements In Progress';
      break;
  }

  const embed = new EmbedBuilder()
    .setTitle(`${user.username}'s ${title}`)
    .setColor('#FFD700')
    .setThumbnail(user.displayAvatarURL({ size: 128 }));

  // Handle empty achievements
  if (achievements.length === 0) {
    embed.setDescription('No achievements found in this category.');
    return embed;
  }

  // Pagination
  const itemsPerPage = 10;
  const totalPages = Math.ceil(achievements.length / itemsPerPage);
  const startIdx = (page - 1) * itemsPerPage;
  const endIdx = Math.min(startIdx + itemsPerPage, achievements.length);
  const displayedAchievements = achievements.slice(startIdx, endIdx);

  // Create fields for visible achievements
  for (const achievement of displayedAchievements) {
    const progressText = achievement.unlocked
      ? `\`✅ Unlocked${achievement.unlockedAt ? ` on ${formatDate(achievement.unlockedAt)}` : ''}\``
      : achievement.progress > 0
        ? `\`${achievement.progress}/${achievement.threshold} Progress\``
        : getEmoji('lock_icon', user.client);

    embed.addFields({
      name: `${achievement.badgeEmoji} ${achievement.name}`,
      value: `${achievement.description}\n${progressText}`,
      inline: false,
    });
  }

  // Add pagination info if needed
  if (totalPages > 1) {
    embed.setFooter({
      text: `Page ${page}/${totalPages} • ${achievements.length} achievements total`,
    });
  }
  else {
    embed.setFooter({ text: `${achievements.length} achievements total` });
  }

  return embed;
}

/**
 * Creates UI components for achievement display
 * @param filteredCount Total number of filtered achievements
 * @param currentView Current view option
 * @param currentPage Current page number
 * @param totalPages Total pages
 * @returns Components for achievements display
 */
export function buildAchievementsComponents(
  filteredCount: number,
  currentView: string,
  currentPage: number = 1,
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  // Create view filter dropdown
  const filterRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(new CustomID('achievement_filter').setArgs(currentPage.toString()).toString())
      .setPlaceholder('Filter achievements...')
      .addOptions([
        new StringSelectMenuOptionBuilder()
          .setLabel('All Achievements')
          .setValue('all')
          .setDefault(currentView === 'all'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Unlocked Achievements')
          .setValue('unlocked')
          .setDefault(currentView === 'unlocked'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Locked Achievements')
          .setValue('locked')
          .setDefault(currentView === 'locked'),
        new StringSelectMenuOptionBuilder()
          .setLabel('In Progress Achievements')
          .setValue('progress')
          .setDefault(currentView === 'progress'),
      ]),
  );

  // Add pagination buttons if needed
  if (filteredCount <= 10) {
    return [filterRow];
  }

  return [filterRow];
}

/**
 * Retrieves achievement data with progress for a user
 * @param userId User ID to get achievements for
 * @param viewFilter Filter type (all, unlocked, locked, progress)
 * @returns List of achievements with progress information
 */
export async function getUserAchievementData(
  userId: string,
  viewFilter: string = 'all',
): Promise<AchievementWithProgress[]> {
  const achievementService = new AchievementService();

  // Get all achievements and user's unlocked ones
  const allAchievements = await achievementService.getAchievements();
  const userAchievements = await achievementService.getUserAchievements(userId);

  // Create a map of unlocked achievements for quick lookup
  const unlockedMap = new Map(userAchievements.map((ua) => [ua.achievementId, ua]));

  // Filter and enrich achievements based on view filter
  const filteredAchievements: AchievementWithProgress[] = [];

  // Process each achievement to add progress data
  for (const achievement of allAchievements) {
    const unlocked = unlockedMap.has(achievement.id);
    const userAchievement = unlockedMap.get(achievement.id);

    // Skip secret achievements that aren't unlocked
    if (achievement.secret && !unlocked && viewFilter !== 'all') continue;

    // Get progress for non-unlocked achievements
    let progress = unlocked ? achievement.threshold : 0;
    if (!unlocked) {
      progress = await achievementService.getProgress(userId, achievement.id);
    }

    const achievementWithProgress: AchievementWithProgress = {
      ...achievement,
      unlocked,
      progress,
      unlockedAt: userAchievement?.unlockedAt,
    };

    // Apply filters
    if (viewFilter === 'unlocked' && !unlocked) continue;
    if (viewFilter === 'locked' && unlocked) continue;
    if (viewFilter === 'progress' && (unlocked || progress === 0)) continue;

    // Don't show secret non-unlocked achievements in 'all' view
    if (viewFilter === 'all' && achievement.secret && !unlocked) continue;

    filteredAchievements.push(achievementWithProgress);
  }

  // Sort achievements: unlocked first (most recent first), then in-progress (highest progress first)
  filteredAchievements.sort((a, b) => {
    // Unlocked achievements sorted by unlock date (most recent first)
    if (a.unlocked && b.unlocked) {
      return b.unlockedAt!.getTime() - a.unlockedAt!.getTime();
    }

    // Unlocked achievements before non-unlocked
    if (a.unlocked && !b.unlocked) return -1;
    if (!a.unlocked && b.unlocked) return 1;

    // For non-unlocked, sort by progress percentage (descending)
    const aProgress = a.progress / a.threshold;
    const bProgress = b.progress / b.threshold;

    if (aProgress !== bProgress) return bProgress - aProgress;

    // Finally sort alphabetically
    return a.name.localeCompare(b.name);
  });

  return filteredAchievements;
}

/**
 * Format a date nicely for display
 * @param date Date to format
 * @returns Formatted date string
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
