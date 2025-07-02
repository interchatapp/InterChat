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
 * InterChat Donation System Library
 *
 * This library provides a donation management system with Ko-fi
 * integration, premium features, and donor perk management.
 *
 * ## Key Features:
 * - Premium tier verification (Ko-fi Supporter $3/month)
 * - Donor perk system with automatic granting
 * - Redis caching for premium status (5-minute TTL)
 *
 * ## Architecture:
 * - Core: DonationManager, PremiumService
 * - Schemas: Ko-fi payload validation, internal donation types
 * - Utils: Currency conversion, validation helpers, constants
 *
 * @example
 * ```typescript
 * import { DonationManager, PremiumService } from '#src/lib/donations';
 *
 * const donationManager = new DonationManager();
 * const premiumService = new PremiumService(donationManager, cacheManager);
 *
 * // Check Ko-fi Supporter tier
 * const hasSupporter = await premiumService.hasSupporterTier(userId);
 *
 * // Process Ko-fi webhook
 * await donationManager.processDonation(kofiPayload, discordUserId);
 * ```
 */

// Core Components
export { DonationManager } from './core/DonationManager.js';
export { PremiumService } from './core/PremiumService.js';

// Types
export * from './types/DonationTypes.js';

// Tiers
export * from './tiers/index.js';

// Utils
export * from './utils/currency.js';
export * from './utils/constants.js';
