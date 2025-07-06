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
  [DonationTier.SUPPORTER]: {
    id: DonationTier.SUPPORTER,
    name: 'Supporter',
    monthlyPrice: 1.99,
    features: {
      supporter_badge: 'Supporter Badge in profile',
      videos_in_calls: 'Send videos (1 per 5 min)',
      custom_profile_theme: 'Custom Hub Banners',
      hub_banners: 'Set a custom banner for your hub',
      hub_rename: 'Rename your hub',
      increased_max_hubs: 'Max hubs 2 -> 5',
      support_development: 'Support development of InterChat',
    },
    duration: 30, // 30 days
  },
};
