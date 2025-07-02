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

import { CURRENCY_CONFIG } from './constants.js';

/**
 * Currency conversion utilities for donation processing
 */

/**
 * Format currency amount for display
 * @param amount Amount to format
 * @param currency Currency code
 * @param locale Locale for formatting (default: 'en-US')
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number, currency: string, locale: string = 'en-US'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: CURRENCY_CONFIG.DECIMAL_PLACES,
      maximumFractionDigits: CURRENCY_CONFIG.DECIMAL_PLACES,
    }).format(amount);
  }
  catch {
    // Fallback formatting if Intl.NumberFormat fails
    return `${currency.toUpperCase()} ${amount.toFixed(CURRENCY_CONFIG.DECIMAL_PLACES)}`;
  }
}

/**
 * Validate currency code
 * @param currency Currency code to validate
 * @returns True if currency is supported
 */
export function isValidCurrency(currency: string): boolean {
  return CURRENCY_CONFIG.BASE_CURRENCY === currency.toUpperCase();
}

/**
 * Validate donation amount
 * @param amount Amount to validate
 * @param currency Currency code
 * @returns Validation result
 */
export function validateDonationAmount(
  amount: number,
  currency: string,
): { valid: boolean; error?: string } {
  // Check if currency is supported
  if (!isValidCurrency(currency)) {
    return {
      valid: false,
      error: `Unsupported currency: ${currency}`,
    };
  }

  // Check minimum amount
  if (amount < CURRENCY_CONFIG.DECIMAL_PLACES) {
    return {
      valid: false,
      error: `Donation amount too small. Minimum: ${formatCurrency(CURRENCY_CONFIG.DECIMAL_PLACES, 'USD')}`,
    };
  }

  // Check maximum amount (anti-fraud measure)
  if (amount > 10000) {
    return {
      valid: false,
      error: `Donation amount too large. Maximum: ${formatCurrency(10000, 'USD')}`,
    };
  }

  return { valid: true };
}
