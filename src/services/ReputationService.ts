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

import db from '#src/utils/Db.js';
import { User } from '#src/generated/prisma/client/client.js';
import type { Snowflake } from 'discord.js';

export class ReputationService {
  async addRating(
    userId: Snowflake,
    rating: number,
    { callId, raterId }: { callId: string; raterId: string },
  ): Promise<void> {
    // Update reputation in database
    await db.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        reputation: rating,
      },
      update: {
        reputation: { increment: rating },
      },
    });

    // Log the rating
    await db.callRating.create({
      data: {
        callId,
        raterId,
        targetId: userId,
        rating: rating > 0 ? 'like' : 'dislike',
        timestamp: new Date(),
      },
    });
  }

  async getReputation(userId: Snowflake, userData?: User): Promise<number> {
    const user = userData ?? await db.user.findUnique({
      where: { id: userId },
      select: { reputation: true },
    });
    return user?.reputation ?? 0;
  }

  async getTopReputation(limit = 10) {
    return await db.user.findMany({
      where: { reputation: { gt: 0 } },
      select: { id: true, reputation: true },
      orderBy: { reputation: 'desc' },
      take: limit,
    });
  }
}
