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

import type {
  Tutorial,
  TutorialStep,
  UserTutorialProgress,
} from '#src/generated/prisma/client/client.js';
import { CacheManager } from '#src/managers/CacheManager.js';
import { ConvertDatesToString } from '#src/types/Utils.js';
import getRedis from '#src/utils/Redis.js';
import { RedisKeys } from '#utils/Constants.js';
import db from '#utils/Db.js';
import type { Snowflake } from 'discord.js';

export default class TutorialService {
  private readonly cacheManager: CacheManager;

  constructor() {
    this.cacheManager = new CacheManager(getRedis(), { prefix: RedisKeys.tutorialData });
  }

  private serializeTutorialDates(tutorial: ConvertDatesToString<Tutorial>): Tutorial {
    return {
      ...tutorial,
      createdAt: new Date(tutorial.createdAt),
      updatedAt: new Date(tutorial.updatedAt),
    };
  }

  private serializeTutorialStepDates(step: ConvertDatesToString<TutorialStep>): TutorialStep {
    return {
      ...step,
      createdAt: new Date(step.createdAt),
      updatedAt: new Date(step.updatedAt),
    };
  }

  /**
   * Get all available tutorials
   */
  public async getAllTutorials(): Promise<Tutorial[]> {
    return await db.tutorial.findMany({
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Get a specific tutorial by ID
   */
  public async getTutorialById(id: string): Promise<Tutorial | null> {
    const fromCache = await this.cacheManager.get<Tutorial>(
      `tutorial:${id}`,
      async () => await db.tutorial.findUnique({ where: { id } }),
    );

    return fromCache ? this.serializeTutorialDates(fromCache) : null;
  }

  /**
   * Get a specific tutorial by name
   */
  public async getTutorialByName(name: string): Promise<Tutorial | null> {
    return await db.tutorial.findUnique({ where: { name } });
  }

  /**
   * Get all steps for a tutorial
   */
  public async getTutorialSteps(tutorialId: string): Promise<TutorialStep[]> {
    const fromCache = await this.cacheManager.get<TutorialStep[]>(
      `tutorial:${tutorialId}:steps`,
      async () =>
        await db.tutorialStep.findMany({
          where: { tutorialId },
          orderBy: { order: 'asc' },
        }),
    );
    return fromCache?.map(this.serializeTutorialStepDates) ?? [];
  }

  /**
   * Get user's progress for a tutorial
   */
  public async getUserProgress(
    userId: Snowflake,
    tutorialId: string,
  ): Promise<UserTutorialProgress | null> {
    return await db.userTutorialProgress.findUnique({
      where: {
        userId_tutorialId: {
          userId,
          tutorialId,
        },
      },
    });
  }

  /**
   * Get all tutorials a user has started or completed
   */
  public async getUserTutorials(userId: Snowflake): Promise<UserTutorialProgress[]> {
    return await db.userTutorialProgress.findMany({
      where: { userId },
      include: { tutorial: true },
    });
  }

  /**
   * Start a tutorial for a user
   */
  public async startTutorial(userId: Snowflake, tutorialId: string): Promise<UserTutorialProgress> {
    return await db.userTutorialProgress.upsert({
      where: {
        userId_tutorialId: {
          userId,
          tutorialId,
        },
      },
      update: {
        currentStepIndex: 0,
        completed: false,
        startedAt: new Date(),
        completedAt: null,
      },
      create: {
        userId,
        tutorialId,
        currentStepIndex: 0,
        completed: false,
      },
    });
  }

  /**
   * Update user's progress in a tutorial
   */
  public async updateProgress(
    userId: Snowflake,
    tutorialId: string,
    data: Partial<Omit<UserTutorialProgress, 'id' | 'userId' | 'tutorialId'>>,
  ): Promise<UserTutorialProgress> {
    return await db.userTutorialProgress.update({
      where: {
        userId_tutorialId: {
          userId,
          tutorialId,
        },
      },
      data,
    });
  }

  /**
   * Mark a tutorial as completed for a user
   */
  public async completeTutorial(
    userId: Snowflake,
    tutorialId: string,
  ): Promise<UserTutorialProgress> {
    return await this.updateProgress(userId, tutorialId, {
      completed: true,
      completedAt: new Date(),
    });
  }

  /**
   * Check if a user has completed all prerequisites for a tutorial
   */
  public async hasCompletedPrerequisites(userId: Snowflake, tutorialId: string): Promise<boolean> {
    const prerequisites = await db.tutorialPrerequisite.findMany({
      where: { tutorialId },
      select: { prerequisiteId: true },
    });

    if (prerequisites.length === 0) return true;

    const prerequisiteIds = prerequisites.map((p) => p.prerequisiteId);

    const completedPrereqs = await db.userTutorialProgress.count({
      where: {
        userId,
        tutorialId: { in: prerequisiteIds },
        completed: true,
      },
    });

    return completedPrereqs === prerequisiteIds.length;
  }

  /**
   * Get the next recommended tutorial for a user based on their progress
   */
  public async getNextRecommendedTutorial(userId: Snowflake): Promise<Tutorial | null> {
    // Get all tutorials the user has not completed
    const completedTutorialIds = (
      await db.userTutorialProgress.findMany({
        where: { userId, completed: true },
        select: { tutorialId: true },
      })
    ).map((p) => p.tutorialId);

    // Find tutorials that are not completed and have all prerequisites met
    const availableTutorials = await db.tutorial.findMany({
      where: {
        id: { notIn: completedTutorialIds },
      },
      include: {
        prerequisites: true,
      },
    });

    // Filter to tutorials where all prerequisites are completed
    for (const tutorial of availableTutorials) {
      if (await this.hasCompletedPrerequisites(userId, tutorial.id)) {
        return tutorial;
      }
    }

    return null;
  }
}
