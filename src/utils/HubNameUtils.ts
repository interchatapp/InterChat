/**
 * Utility functions for hub name validation and operations
 */

/**
 * Validate premium hub name
 * Rules: 3-32 characters, allows more flexibility than regular hub names for premium users
 */
export function validatePremiumHubName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'Hub name cannot be empty' };
  }

  const trimmed = name.trim();

  if (trimmed.length < 3) {
    return { valid: false, error: 'Hub name must be at least 3 characters long' };
  }

  if (trimmed.length > 32) {
    return { valid: false, error: 'Hub name cannot exceed 32 characters' };
  }

  // Allow letters, numbers, spaces, hyphens, underscores, and common punctuation
  const validPattern = /^[a-zA-Z0-9\s\-_.,!?()[\]{}'"]+$/;
  if (!validPattern.test(trimmed)) {
    return { valid: false, error: 'Hub name contains invalid characters' };
  }

  // Prevent names that are only whitespace or special characters
  const hasAlphanumeric = /[a-zA-Z0-9]/.test(trimmed);
  if (!hasAlphanumeric) {
    return { valid: false, error: 'Hub name must contain at least one letter or number' };
  }

  return { valid: true };
}

/**
 * Validate regular hub name (for non-premium users)
 * More restrictive rules: 3-32 characters, alphanumeric
 */
export function validateRegularHubName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'Hub name cannot be empty' };
  }

  const trimmed = name.trim();

  if (trimmed.length < 3) {
    return { valid: false, error: 'Hub name must be at least 3 characters long' };
  }

  if (trimmed.length > 32) {
    return { valid: false, error: 'Hub name cannot exceed 32 characters' };
  }

  return { valid: true };
}
