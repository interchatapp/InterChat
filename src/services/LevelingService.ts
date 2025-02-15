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

import UserDbService from '#src/services/UserDbService.js';
import db from '#src/utils/Db.js';
import { calculateRequiredXP } from '#src/utils/calculateLevel.js';
import type { PrismaClient, UserData } from '@prisma/client';
import { Colors, type Message } from 'discord.js';

type LeaderboardType = 'xp' | 'level' | 'messages';

interface UserStats {
  xp: { rank: number };
  level: { rank: number };
  messages: { rank: number };
}

interface LevelingConfig {
  xpRange: { min: number; max: number };
  cooldownSeconds: number;
}

export class LevelingService {
  private readonly db: PrismaClient;
  private readonly userCooldowns: Map<string, Date>;
  private readonly config: LevelingConfig;
  private readonly userService = new UserDbService();

  constructor(prisma?: PrismaClient, config: Partial<LevelingConfig> = {}) {
    this.db = prisma ?? db;
    this.userCooldowns = new Map();
    this.config = {
      xpRange: { min: 3, max: 8 },
      cooldownSeconds: 5,
      ...config,
    };
  }

  public async handleMessage(message: Message<true>): Promise<void> {
    if (!this.isValidMessage(message)) return;

    const userId = message.author.id;
    if (this.isUserOnCooldown(userId)) return;

    await this.processMessageXP(message);
    this.updateUserCooldown(userId);
  }

  public async getStats(userId: string, username: string): Promise<
    UserData & {
      stats: UserStats;
      requiredXP: number;
    }
  > {
    const user = await this.getOrCreateUser(userId, username);
    const stats = await this.calculateUserStats(user);

    return {
      ...user,
      stats,
      requiredXP: calculateRequiredXP(user.level),
    };
  }

  public async getLeaderboard(type: LeaderboardType = 'xp', limit = 10): Promise<UserData[]> {
    const orderBy = this.getLeaderboardOrdering(type);

    return await this.db.userData.findMany({ orderBy, take: limit });
  }

  private isValidMessage(message: Message<true>): boolean {
    return !message.author.bot;
  }

  private isUserOnCooldown(userId: string): boolean {
    const lastMessage = this.userCooldowns.get(userId);
    if (!lastMessage) return false;

    const cooldownMs = this.config.cooldownSeconds * 1000;
    return Date.now() - lastMessage.getTime() < cooldownMs;
  }

  private async processMessageXP(message: Message<true>): Promise<void> {
    const user = await this.getOrCreateUser(message.author.id, message.author.username);
    const earnedXP = this.generateXP();
    const { newLevel, totalXP } = this.calculateXPAndLevel(user, earnedXP);

    if (newLevel > user.level) {
      await this.handleLevelUp(message, newLevel);
    }

    await this.updateUserData(user.id, {
      xp: totalXP,
      level: newLevel,
      messageCount: user.messageCount + 1,
    });
  }

  private generateXP(): number {
    const { min, max } = this.config.xpRange;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private calculateXPAndLevel(
    user: UserData,
    earnedXP: number,
  ): {
      newLevel: number;
      newXP: number;
      totalXP: number;
    } {
    const requiredXP = calculateRequiredXP(user.level);
    const currentLevelXP = user.xp % requiredXP;
    const totalXP = user.xp + earnedXP;
    let newXP = currentLevelXP + earnedXP;
    let newLevel = user.level;

    if (newXP >= requiredXP) {
      newLevel = user.level + 1;
      newXP -= requiredXP;
    }

    return { newLevel, newXP, totalXP };
  }


  private async handleLevelUp(message: Message<true>, newLevel: number): Promise<void> {
    // TODO: also send a random tip along with the level up message
    await message.channel.send({
      embeds: [
        {
          title: '🎉 Level Up!',
          description: `Congratulations ${message.author}! You've reached level ${newLevel}!`,
          footer: {
            text: `Sent for: ${message.author.username}`,
            icon_url: message.author.displayAvatarURL(),
          },
          color: Colors.Green,
        },
      ],
    }).catch(() => null);
  }

  private async getOrCreateUser(userId: string, username: string): Promise<UserData> {
    const user = await this.userService.getUser(userId);

    return user ?? (await this.userService.createUser({ id: userId, username }));
  }

  private async calculateUserStats(user: UserData): Promise<UserStats> {
    return {
      xp: {
        rank: await this.calculateRank('xp', user.xp),
      },
      level: {
        rank: await this.calculateRank('level', user.level),
      },
      messages: {
        rank: await this.calculateRank('messageCount', user.messageCount),
      },
    };
  }

  private async calculateRank(
    field: 'xp' | 'level' | 'messageCount',
    value: number,
  ): Promise<number> {
    return (
      (await this.db.userData.count({
        where: {
          [field]: { gt: value },
        },
      })) + 1
    );
  }

  private async updateUserData(userId: string, data: Partial<UserData>): Promise<void> {
    await this.userService.updateUser(userId, { ...data, lastMessageAt: new Date() });
  }

  private updateUserCooldown(userId: string): void {
    this.userCooldowns.set(userId, new Date());
  }

  private getLeaderboardOrdering(type: LeaderboardType) {
    const orderByMap = {
      xp: { xp: 'desc' as const },
      level: { level: 'desc' as const },
      messages: { messageCount: 'desc' as const },
    };

    return orderByMap[type];
  }
}
