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

/**
 * Donation system constants
 */

/**
 * Cache configuration constants
 */
export const CACHE_CONFIG = {
  PREMIUM_STATUS_TTL: 5 * 60 * 1000, // 5 minutes
  DONATION_STATS_TTL: 15 * 60 * 1000, // 15 minutes
  DONOR_RANK_TTL: 60 * 60 * 1000, // 1 hour

  // Cache key prefixes
  PREMIUM_STATUS_PREFIX: 'premium:status',
  SUPPORTER_TIER_PREFIX: 'premium:supporter',
  DONATION_STATS_PREFIX: 'donation:stats',
  DONOR_RANK_PREFIX: 'donation:rank',
} as const;

/**
 * Currency constants
 */
export const CURRENCY_CONFIG = {
  BASE_CURRENCY: 'USD',
  DECIMAL_PLACES: 1,
};
