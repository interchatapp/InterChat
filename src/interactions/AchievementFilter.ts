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

import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { PaginationManager } from '#src/utils/ui/PaginationManager.js';
import { ContainerBuilder, TextDisplayBuilder } from 'discord.js';
import UserDbService from '#src/services/UserDbService.js';
import { buildAchievementsEmbed, getUserAchievementData } from '#src/utils/AchievementUtils.js';

/**
 * Handler for achievement filter dropdown interactions
 */
export default class AchievementFilterHandler {
  @RegisterInteractionHandler('achievement_filter')
  async handleFilterChange(ctx: ComponentContext): Promise<void> {
    if (!ctx.isStringSelectMenu()) return;

    await ctx.deferUpdate();

    // Get the selected filter option
    const newView = ctx.values?.[0];
    if (!newView) return;

    // Use the interaction user directly
    const targetUser = ctx.user;

    // Create service instance
    const userService = new UserDbService();

    // Ensure user exists in database
    await userService.upsertUser(targetUser.id, {
      name: targetUser.username,
      image: targetUser.displayAvatarURL(),
    });

    // Get achievement data with new filter
    const achievementData = await getUserAchievementData(targetUser.id, newView);

    // If no achievements, show a message
    if (achievementData.length === 0) {
      const noAchievementsEmbed = await buildAchievementsEmbed(targetUser, [], newView);

      await ctx.editReply({ embeds: [noAchievementsEmbed], components: [] });
      return;
    }

    // Use PaginationManager for paginated results
    const paginationManager = new PaginationManager({
      client: ctx.client,
      identifier: `achievements-${targetUser.id}-${newView}`,
      items: achievementData,
      itemsPerPage: 10,
      idleTimeout: 180000, // 3 minutes
      contentGenerator: (pageIndex, itemsOnPage, totalPages, totalItems) => {
        const container = new ContainerBuilder();

        // Convert embed to text content for the new system
        const pageNumber = pageIndex + 1;

        // Create title based on view
        let title = 'All Achievements';
        switch (newView) {
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

        // Add header
        const headerText = new TextDisplayBuilder().setContent(
          `## ${targetUser.username}'s ${title}\n${
            totalPages > 1
              ? `Page ${pageNumber}/${totalPages} • ${totalItems} achievements total`
              : `${totalItems} achievements total`
          }`,
        );
        container.addTextDisplayComponents(headerText);

        // Add achievements content
        const achievementsText = itemsOnPage
          .map((achievement) => {
            const progressText = achievement.unlocked
              ? `✅ Unlocked${achievement.unlockedAt ? ` on ${formatDate(achievement.unlockedAt)}` : ''}`
              : achievement.progress > 0
                ? `${achievement.progress}/${achievement.threshold} Progress`
                : '🔒 Locked';

            return `**${achievement.badgeEmoji} ${achievement.name}**\n${achievement.description}\n\`${progressText}\``;
          })
          .join('\n\n');

        const contentText = new TextDisplayBuilder().setContent(achievementsText);
        container.addTextDisplayComponents(contentText);

        return container;
      },
    });

    await paginationManager.start(ctx);
  }
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
