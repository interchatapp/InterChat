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

import { DonationTier } from '#src/generated/prisma/client/index.js';
import { type Tier } from './TierTypes.js';

/**
 * Defines the different donation tiers and their benefits.
 */
export const Tiers: Record<DonationTier, Tier> = {
  [DonationTier.BRONZE]: {
    id: DonationTier.BRONZE,
    name: 'Bronze Supporter',
    monthlyPrice: 1.99,
    features: {
      supporter_badge: 'Supporter Badge in profile',
      early_access: 'Early access to new features',
      custom_profile_theme: 'Custom Profile Theme',
      hub_rename: 'Rename your hub',
    },
    duration: 30, // 30 days
  },
  [DonationTier.SILVER]: {
    id: DonationTier.SILVER,
    name: 'Silver Supporter',
    monthlyPrice: 4.99,
    features: {
      bronze_perks: 'All Bronze perks',
      priority_support: 'Priority support',
      custom_profile_background: 'Custom Pro,file Background',
      hub_customization: 'Custom Hub Customization',
      exclusive_content: 'Access to exclusive content',
    },
    duration: 30, // 30 days
  },
  [DonationTier.GOLD]: {
    id: DonationTier.GOLD,
    name: 'Gold Supporter',
    monthlyPrice: 7.99,
    features: {
      silver_perks: 'All Silver perks',
      unlimited_media: 'Unlimited Media Sharing',
      custom_hub_name: 'Custom Hub Name',
      supporter_badge: 'Supporter Donor Badge',
    },
    duration: 30, // 30 days
  },
};
