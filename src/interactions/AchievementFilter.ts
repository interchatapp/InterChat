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
import { Pagination } from '#src/modules/Pagination.js';
import UserDbService from '#src/services/UserDbService.js';
import {
  buildAchievementsComponents,
  buildAchievementsEmbed,
  getUserAchievementData,
} from '#src/utils/AchievementUtils.js';

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

    // Create paginator
    const paginator = new Pagination(ctx.client);

    // Create pages for pagination
    const itemsPerPage = 10;
    const totalAchievements = achievementData.length;

    // If no achievements, show a message
    if (totalAchievements === 0) {
      const noAchievementsEmbed = await buildAchievementsEmbed(targetUser, [], newView);

      await ctx.editReply({ embeds: [noAchievementsEmbed], components: [] });
      return;
    }

    // Create pages
    for (let i = 0; i < totalAchievements; i += itemsPerPage) {
      const pageNumber = Math.floor(i / itemsPerPage) + 1;

      const pageEmbed = await buildAchievementsEmbed(
        targetUser,
        achievementData,
        newView,
        pageNumber,
      );

      // Add filter dropdown for achievements
      const filterRow = buildAchievementsComponents(totalAchievements, newView, pageNumber);

      paginator.addPage({ embeds: [pageEmbed], components: filterRow });
    }

    // Run the paginator
    await paginator.run(ctx.interaction, {
      idle: 180000, // 3 minutes
    });
  }
}
