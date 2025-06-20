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

import db from '#utils/Db.js';
import { type User, Achievement, UserAchievement } from '#src/generated/prisma/client/client.js';
import type { Snowflake } from 'discord.js';

export interface UserProfileData {
  interests: string[];
  favoriteHubs: string[];
}

export class UserProfileService {
  /**
   * Get or create user profile with enhanced data
   */
  async getProfile(
    userId: Snowflake,
  ): Promise<User & { achievements: (UserAchievement & { achievement: Achievement })[] }> {
    const user = await db.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        activityLevel: 'CASUAL',
        interests: [],
        favoriteHubs: [],
      },
      update: {},
      include: {
        achievements: {
          include: { achievement: true },
          orderBy: { unlockedAt: 'desc' },
        },
      },
    });

    return user;
  }

  /**
   * Update user profile data
   */
  async updateProfile(userId: Snowflake, data: Partial<UserProfileData>): Promise<User> {
    return await db.user.update({
      where: { id: userId },
      data: {
        interests: data.interests,
        favoriteHubs: data.favoriteHubs,
      },
    });
  }

  /**
   * Add hub to user's favorites
   */
  async addFavoriteHub(userId: Snowflake, hubId: string): Promise<void> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { favoriteHubs: true },
    });

    if (!user || user.favoriteHubs.includes(hubId)) return;

    await db.user.update({
      where: { id: userId },
      data: {
        favoriteHubs: [...user.favoriteHubs, hubId],
      },
    });
  }

  /**
   * Remove hub from user's favorites
   */
  async removeFavoriteHub(userId: Snowflake, hubId: string): Promise<void> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { favoriteHubs: true },
    });

    if (!user) return;

    await db.user.update({
      where: { id: userId },
      data: {
        favoriteHubs: user.favoriteHubs.filter((id) => id !== hubId),
      },
    });
  }
}
