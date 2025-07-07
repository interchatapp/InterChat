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
import { DonationManager } from './DonationManager.js';
import Logger from '#src/utils/Logger.js';
import { CACHE_CONFIG } from '../utils/constants.js';
import UserDbService from '#src/services/UserDbService.js';
import { DonationTierDefinition } from '#src/generated/prisma/client/index.js';
import db from '#src/utils/Db.js';

/**
 * Service for managing premium features based on donation tiers.
 */
export class PremiumService {
  private readonly donationManager: DonationManager;
  private readonly cacheManager: CacheManager;
  private readonly userDbManager = new UserDbService();

  constructor(donationManager: DonationManager, cacheManager: CacheManager) {
    this.donationManager = donationManager;
    this.cacheManager = cacheManager;
  }

  async getUserTier(userId: string): Promise<DonationTierDefinition | null> {
    const cacheKey = `${CACHE_CONFIG.PREMIUM_STATUS_PREFIX}:${userId}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      return cached as DonationTierDefinition;
    }

    const user = await this.userDbManager.getUser(userId);
    const tier = user?.donationTierId
      ? await db.donationTierDefinition.findUnique({ where: { id: user.donationTierId } })
      : null;

    if (tier && user?.donationExpiresAt && user.donationExpiresAt < new Date()) {
      // TODO: Remove donor role when implemented
      return null;
    }

    await this.cacheManager.set(cacheKey, tier, CACHE_CONFIG.PREMIUM_STATUS_TTL);
    return tier;
  }

  async hasFeature(userId: string, _feature: string): Promise<boolean> {
    const tier = await this.getUserTier(userId);
    // For now, any tier grants basic premium features
    // TODO: Implement feature mapping in database or configuration
    return tier !== null;
  }

  async getTierFeatures(userId: string): Promise<Record<string, string> | null> {
    const tier = await this.getUserTier(userId);
    if (!tier) return null;

    // TODO: Store features in database or configuration
    // For now, return basic supporter features based on tier name
    return {
      supporter_badge: 'Supporter Badge in profile',
      videos_in_calls: 'Send videos (1 per 5 min)',
      custom_profile_theme: 'Custom Hub Banners',
      hub_banners: 'Set a custom banner for your hub',
      hub_rename: 'Rename your hub',
      increased_max_hubs: 'Max hubs 2 -> 5',
      support_development: 'Support development of InterChat',
    };
  }

  async invalidatePremiumCache(userId: string): Promise<void> {
    const cacheKey = `${CACHE_CONFIG.PREMIUM_STATUS_PREFIX}:${userId}`;
    await this.cacheManager.delete(cacheKey);
    Logger.debug(`Invalidated premium cache for user ${userId}`);
  }
}
