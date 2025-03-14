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

import { CacheManager } from '#src/managers/CacheManager.js';
import getRedis from '#src/utils/Redis.js';
import type { ConvertDatesToString } from '#types/Utils.d.ts';
import { RedisKeys } from '#utils/Constants.js';
import db from '#utils/Db.js';
import type { Prisma, User } from '@prisma/client';
import type { Snowflake } from 'discord.js';

export default class UserDbService {
  private readonly cacheManager: CacheManager;
  private readonly VOTE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.cacheManager = new CacheManager(getRedis(), { prefix: RedisKeys.userData });
  }

  private serializeUserDates(user: ConvertDatesToString<User>): User {
    const dates = {
      lastMessageAt: new Date(user.lastMessageAt),
      updatedAt: new Date(user.updatedAt),
      lastVoted: user.lastVoted ? new Date(user.lastVoted) : null,
      inboxLastReadDate: new Date(user.inboxLastReadDate ?? 0),
      createdAt: new Date(user.createdAt),
    };
    return { ...user, ...dates };
  }

  public async getUser(id: Snowflake): Promise<User | null> {
    const result = await this.cacheManager.get<User>(
      id,
      async () => await db.user.findFirst({ where: { id } }),
    );

    return result ? this.serializeUserDates(result) : null;
  }

  public async createUser(data: Prisma.UserCreateInput): Promise<User> {
    const user = await db.user.create({ data });
    await this.cacheUser(user);
    return user;
  }

  public async updateUser(id: Snowflake, data: Prisma.UserUpdateInput): Promise<User> {
    const user = await db.user.update({ where: { id }, data });
    await this.cacheUser(user);
    return user;
  }

  public async upsertUser(
    id: Snowflake,
    data: Omit<Prisma.UserUpsertArgs['create'], 'id'>,
  ): Promise<User> {
    const user = await db.user.upsert({
      where: { id },
      create: { ...data, id },
      update: data,
    });
    await this.cacheUser(user);
    return user;
  }

  public async userVotedToday(id: Snowflake, userData?: User): Promise<boolean> {
    const user = userData ?? (await this.getUser(id));
    if (!user?.lastVoted) return false;

    const lastVoteTime = new Date(user.lastVoted).getTime();
    const timeSinceVote = Date.now() - lastVoteTime;
    return timeSinceVote < this.VOTE_COOLDOWN_MS;
  }

  // Moderation methods
  public async ban(id: string, reason: string, username?: string): Promise<void> {
    await this.upsertUser(id, {
      username,
      voteCount: 0,
      banReason: reason,
    });
  }

  public async unban(id: string, username?: string): Promise<void> {
    await this.upsertUser(id, {
      username,
      voteCount: 0,
      banReason: null,
    });
  }

  private async cacheUser(user: User, expirySecs?: number): Promise<void> {
    await this.cacheManager.set(user.id, user, expirySecs);
  }
}
