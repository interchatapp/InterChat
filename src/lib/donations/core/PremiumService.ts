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
import { Tiers } from '../tiers/index.js';
import UserDbService from '#src/services/UserDbService.js';
import { DonationTier } from '#src/generated/prisma/client/index.js';

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

  async getUserTier(userId: string): Promise<DonationTier | null> {
    const cacheKey = `${CACHE_CONFIG.PREMIUM_STATUS_PREFIX}:${userId}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      return cached as DonationTier;
    }

    const user = await this.userDbManager.getUser(userId);
    const tier = user?.donationTier as DonationTier | null;

    if (tier && user?.donationExpiresAt && user.donationExpiresAt < new Date()) {
      this.donationManager.removeDonorRole(userId).catch(() => null);
      return null;
    }

    await this.cacheManager.set(cacheKey, tier, CACHE_CONFIG.PREMIUM_STATUS_TTL);
    return tier;
  }

  async hasFeature(userId: string, feature: string): Promise<boolean> {
    const tier = await this.getUserTier(userId);
    if (!tier) return false;

    const tierData = Tiers[tier];
    return tierData.features.includes(feature);
  }

  async getTierFeatures(userId: string): Promise<string[]> {
    const tier = await this.getUserTier(userId);
    if (!tier) return [];

    return Tiers[tier].features;
  }

  async invalidatePremiumCache(userId: string): Promise<void> {
    const cacheKey = `${CACHE_CONFIG.PREMIUM_STATUS_PREFIX}:${userId}`;
    await this.cacheManager.delete(cacheKey);
    Logger.debug(`Invalidated premium cache for user ${userId}`);
  }
}
