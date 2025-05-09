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

import type { BlockWordAction } from '#src/generated/prisma/client/client.js';
import db from '#src/utils/Db.js';
import Logger from '#src/utils/Logger.js';
import { CacheManager } from '#src/managers/CacheManager.js';
import { RedisKeys } from '#src/utils/Constants.js';
import getRedis from '#src/utils/Redis.js';

/**
 * Represents a compiled rule for efficient pattern matching.
 * Uses serializable data structures for Redis storage.
 */
interface CompiledRule {
  id: string;
  hubId: string;
  name: string;
  actions: BlockWordAction[];
  exactMatches: string[]; // For exact word matches (lowercase, array for serialization)
  patternStrings: string[]; // Store pattern strings instead of RegExp objects
  lastUpdated: number; // Timestamp of when this rule was compiled
}

/**
 * In-memory representation of a compiled rule with pre-compiled RegExp objects
 * for faster execution during message checks.
 */
interface CompiledRuleWithRegex extends CompiledRule {
  regexPatterns: RegExp[]; // Pre-compiled RegExp objects
}

/**
 * Result of checking a message against anti-swear rules.
 */
export interface AntiSwearCheckResult {
  blocked: boolean;
  rule: CompiledRule | null; // The rule that was triggered
  matches: string[]; // The specific words/patterns that matched
}

/**
 * Manages anti-swear functionality with optimized pattern matching.
 * Utilizes a two-tier caching system: an in-memory cache for hot rules
 * and Redis for distributed caching across shards.1
 */
export default class AntiSwearManager {
  private static instance: AntiSwearManager;
  private readonly redisCache: CacheManager;
  private readonly REDIS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

  // In-memory cache for frequently accessed rules (with compiled regex)
  private readonly memoryCache = new Map<
    string,
    {
      rules: CompiledRuleWithRegex[];
      timestamp: number; // When these rules were added to memory cache
    }
  >();
  private readonly MEMORY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  private readonly MAX_REGEX_EXECUTION_TIME_MS = 50; // Max time for a single regex match

  private constructor() {
    this.redisCache = new CacheManager(getRedis(), {
      prefix: RedisKeys.AntiSwear,
      expirationMs: this.REDIS_CACHE_TTL_MS,
    });

    // Periodically clean up expired entries from the in-memory cache
    setInterval(() => this.cleanupMemoryCache(), 10 * 60 * 1000); // Every 10 minutes
  }

  /**
   * Cleans up expired entries in the in-memory cache.
   */
  private cleanupMemoryCache(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, value] of this.memoryCache.entries()) {
      if (now - value.timestamp > this.MEMORY_CACHE_TTL_MS) {
        this.memoryCache.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      Logger.debug(
        `Cleaned up ${expiredCount} expired entries from AntiSwearManager memory cache.`,
      );
    }
  }

  /**
   * Gets the singleton instance of AntiSwearManager.
   */
  public static getInstance(): AntiSwearManager {
    if (!AntiSwearManager.instance) {
      AntiSwearManager.instance = new AntiSwearManager();
    }
    return AntiSwearManager.instance;
  }

  /**
   * Checks if a message content violates any anti-swear rules for a given hub.
   * @param content The message content to check.
   * @param hubId The ID of the hub to get rules for.
   * @returns An AntiSwearCheckResult indicating if the message is blocked and details.
   */
  public async checkMessage(content: string, hubId: string): Promise<AntiSwearCheckResult> {
    if (!content.trim()) {
      return { blocked: false, rule: null, matches: [] };
    }

    const rules = await this.getRulesForHub(hubId);
    if (rules.length === 0) {
      return { blocked: false, rule: null, matches: [] };
    }

    const normalizedContent = content.toLowerCase();

    // Extract words from the message. \b\w+\b matches sequences of word characters.
    // Using a Set avoids redundant checks for the same word in exactMatches.
    const wordsInMessage = new Set<string>(
      (normalizedContent.match(/\b\w+\b/g) || [])
        .map((word) => word.replace(/[^\w]/g, ''))
        .filter(Boolean), // Remove empty strings that might result from replace
    );

    for (const rule of rules) {
      // 1. Check for exact word matches (fastest)
      for (const exactMatch of rule.exactMatches) {
        if (wordsInMessage.has(exactMatch)) {
          // exactMatches are already lowercased
          return { blocked: true, rule, matches: [exactMatch] };
        }
      }

      // 2. Check with regex patterns for more complex matches
      for (let i = 0; i < rule.regexPatterns.length; i++) {
        const pattern = rule.regexPatterns[i];
        try {
          const startTime = Date.now();
          const regexMatchResult = normalizedContent.match(pattern);
          const executionTime = Date.now() - startTime;

          if (executionTime > this.MAX_REGEX_EXECUTION_TIME_MS) {
            Logger.warn(
              `Regex pattern took ${executionTime}ms to execute (over ${this.MAX_REGEX_EXECUTION_TIME_MS}ms limit). Pattern: ${pattern.toString()}`,
            );
          }

          if (regexMatchResult) {
            // Return all matched groups or the full match, trimmed and filtered for empty strings
            const actualMatches = regexMatchResult
              .map((m) => m?.trim())
              .filter(Boolean) as string[];
            if (actualMatches.length > 0) {
              return {
                blocked: true,
                rule,
                matches: actualMatches,
              };
            }
          }
        }
        catch (error) {
          Logger.error(
            `Error executing regex pattern: "${rule.patternStrings[i]}" for rule "${rule.name}" (ID: ${rule.id})`,
            error,
          );
          // Continue to the next pattern or rule
        }
      }
    }

    return { blocked: false, rule: null, matches: [] };
  }

  /**
   * Retrieves rules for a hub, utilizing a multi-layer cache (memory -> Redis -> DB).
   * @param hubId The ID of the hub.
   * @returns A promise that resolves to an array of compiled rules with regex patterns.
   */
  private async getRulesForHub(hubId: string): Promise<CompiledRuleWithRegex[]> {
    const cacheKey = `${RedisKeys.HubRules}:${hubId}`;
    const now = Date.now();

    // 1. Check in-memory cache
    const memoryCached = this.memoryCache.get(cacheKey);
    if (memoryCached && now - memoryCached.timestamp < this.MEMORY_CACHE_TTL_MS) {
      return memoryCached.rules;
    }

    // 2. Check Redis cache (or load from DB if not in Redis)
    const rulesFromRedis =
      (await this.redisCache.get<CompiledRule[]>(cacheKey, () => this.loadRulesForHub(hubId))) ||
      [];

    // Compile regex patterns for rules retrieved from Redis/DB
    const rulesWithRegex = rulesFromRedis.map((rule) => this.compileRuleWithRegex(rule));

    // Store in memory cache for faster subsequent access
    this.memoryCache.set(cacheKey, { rules: rulesWithRegex, timestamp: now });
    return rulesWithRegex;
  }

  /**
   * Compiles regex pattern strings from a rule into RegExp objects.
   * @param rule The rule with pattern strings.
   * @returns The rule enhanced with compiled RegExp objects.
   */
  private compileRuleWithRegex(rule: CompiledRule): CompiledRuleWithRegex {
    const regexPatterns: RegExp[] = rule.patternStrings
      .map((patternString) => {
        try {
          // 'i' flag for case-insensitivity. Global 'g' is not used here as we
          // often want to stop at the first match within a rule.
          // If specific patterns need global, it should be part of the patternString definition.
          return new RegExp(patternString, 'i');
        }
        catch (error) {
          Logger.error(
            `Failed to compile regex pattern: "${patternString}" for rule "${rule.name}" (ID: ${rule.id})`,
            error,
          );
          return new RegExp('(?!)'); // A regex that never matches
        }
      })
      .filter((pattern) => pattern.source !== '(?!)'); // Filter out uncompiled patterns

    return { ...rule, regexPatterns };
  }

  /**
   * Loads rules from the database for a specific hub and compiles them.
   * This is the fallback when rules are not found in any cache.
   * @param hubId The ID of the hub.
   * @returns A promise that resolves to an array of compiled rules.
   */
  private async loadRulesForHub(hubId: string): Promise<CompiledRule[]> {
    try {
      const dbRules = await db.antiSwearRule.findMany({
        where: { hubId },
        include: { patterns: true }, // Assuming 'patterns' is a relation to pattern strings
      });

      const compiledRules: CompiledRule[] = dbRules.map((rule) => {
        const exactMatches: string[] = [];
        const patternStrings: string[] = [];

        for (const p of rule.patterns) {
          const originalPattern = p.pattern; // The raw pattern string from DB

          if (!originalPattern.trim()) {
            // Skip empty patterns
            Logger.warn(`Skipping empty pattern for rule "${rule.name}" (ID: ${rule.id})`);
            continue;
          }

          // For "Exact Match" type (no '*' wildcards)
          if (!originalPattern.includes('*')) {
            // Treat as an exact match, store in lowercase for case-insensitive comparison
            exactMatches.push(originalPattern.toLowerCase());
          }
          else {
            // Handle patterns with '*' (Prefix, Suffix, Contains Match)
            const wildcardCount = (originalPattern.match(/\*/g) || []).length;

            if (wildcardCount > 5) {
              Logger.error(
                `Pattern "${originalPattern}" for rule "${rule.name}" (ID: ${rule.id}) has too many wildcards (${wildcardCount}). Skipping to protect performance.`,
              );
              continue;
            }
            if (wildcardCount > 2 && wildcardCount <= 5) {
              Logger.warn(
                `Pattern "${originalPattern}" for rule "${rule.name}" (ID: ${rule.id}) has ${wildcardCount} wildcards, which may impact performance.`,
              );
            }

            // 1. Escape all standard regex metacharacters from the original pattern.
            //    This includes characters like ., +, ?, ^, $, etc., and also '/'
            const tempRegexStr = originalPattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&');
            // Example: if originalPattern is "w+rd*", tempRegexStr becomes "w\\+rd*"
            // Example: if originalPattern is "*hi/fi*", tempRegexStr becomes "*hi\\/fi*"

            // 2. Convert the user's wildcard '*' (which is still '*' in tempRegexStr) to '.*'
            const regexStr = tempRegexStr.replace(/\*/g, '.*');
            // Example: "w\\+rd*" becomes "w\\+rd.*"
            // Example: "*hi\\/fi*" becomes ".*hi\\/fi.*"
            // Example: "*hii*" becomes ".*hii.*"

            // 3. Construct the final regex with word boundaries (lookarounds preferred)
            //    This ensures that patterns like "word*" match "wordings" but not "awordings".
            //    And "*word" matches "myword" but not "mywordings".
            //    And "*word*" matches "mywordings" or "keyword".
            try {
              // Use lookahead/lookbehind for better word boundary detection.
              // This helps with partial word matches and special characters correctly.
              const finalPattern = `(?<![\\w])${regexStr}(?![\\w])`;
              new RegExp(finalPattern); // Test if the regex compiles
              patternStrings.push(finalPattern);
            }
            catch (lookaroundError) {
              Logger.warn(
                `Lookaround regex failed for pattern "${originalPattern}" (rule "${rule.name}", generated: ${regexStr}). Error: ${lookaroundError.message}. Attempting fallback.`,
              );
            }
          }
        }

        return {
          id: rule.id,
          hubId: rule.hubId,
          name: rule.name,
          actions: rule.actions,
          exactMatches,
          patternStrings,
          lastUpdated: Date.now(),
        };
      });

      Logger.debug(
        `Loaded and compiled ${compiledRules.length} anti-swear rules for hub ${hubId} from database.`,
      );
      return compiledRules;
    }
    catch (error) {
      Logger.error(`Error loading anti-swear rules from database for hub ${hubId}:`, error);
      return []; // Return empty array on error to prevent system outage
    }
  }

  /**
   * Invalidates the cache for a specific hub in both memory and Redis.
   * @param hubId The ID of the hub whose cache should be invalidated.
   */
  public async invalidateCache(hubId: string): Promise<void> {
    const cacheKey = `${RedisKeys.HubRules}:${hubId}`;
    await this.redisCache.delete(cacheKey);
    this.memoryCache.delete(cacheKey);
    Logger.debug(`Invalidated anti-swear cache for hub ${hubId}.`);
  }

  /**
   * Invalidates all anti-swear caches (all hubs) in both memory and Redis.
   */
  public async invalidateAllCaches(): Promise<void> {
    // For Redis, CacheManager's clear method relies on the prefix
    await this.redisCache.clear();
    this.memoryCache.clear();
    Logger.debug('Invalidated all anti-swear caches.');
  }
}
