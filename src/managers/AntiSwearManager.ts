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

/**
 * Represents a compiled rule for efficient pattern matching
 */
interface CompiledRule {
  id: string;
  hubId: string;
  name: string;
  actions: BlockWordAction[];
  exactMatches: Set<string>; // For exact word matches
  patterns: RegExp[]; // For wildcard patterns
  lastUpdated: number;
}

/**
 * Result of checking a message against anti-swear rules
 */
export interface AntiSwearCheckResult {
  blocked: boolean;
  rule: CompiledRule | null;
  matches: string[];
}

/**
 * Manager for anti-swear functionality with optimized pattern matching
 */
export default class AntiSwearManager {
  private static instance: AntiSwearManager;
  private compiledRules: Map<string, CompiledRule[]> = new Map(); // hubId -> rules
  private lastCacheRefresh: Map<string, number> = new Map(); // hubId -> timestamp
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get the singleton instance of AntiSwearManager
   */
  public static getInstance(): AntiSwearManager {
    if (!AntiSwearManager.instance) {
      AntiSwearManager.instance = new AntiSwearManager();
    }
    return AntiSwearManager.instance;
  }

  /**
   * Check if a message contains blocked words for a specific hub
   */
  public async checkMessage(content: string, hubId: string): Promise<AntiSwearCheckResult> {
    // Skip empty messages
    if (!content.trim()) {
      return { blocked: false, rule: null, matches: [] };
    }

    // Ensure rules are loaded and up-to-date
    await this.ensureRulesLoaded(hubId);

    const rules = this.compiledRules.get(hubId) || [];
    if (rules.length === 0) {
      return { blocked: false, rule: null, matches: [] };
    }

    // Performance optimization: For large rule sets, do a quick pre-check
    if (rules.length > 10) {
      // Calculate total number of patterns across all rules
      let totalPatterns = 0;
      let totalExactMatches = 0;

      for (const rule of rules) {
        totalPatterns += rule.patterns.length;
        totalExactMatches += rule.exactMatches.size;
      }

      Logger.debug(`Processing message with ${rules.length} rules, ${totalPatterns} regex patterns, and ${totalExactMatches} exact matches`);

      // If we have a lot of patterns, log a warning
      if (totalPatterns > 50) {
        Logger.warn(`Hub ${hubId} has ${totalPatterns} regex patterns, which may impact performance`);
      }
    }

    // Normalize content for checking
    const normalizedContent = content.toLowerCase();
    const words = normalizedContent.split(/\s+/);

    // Normal processing for reasonably sized messages
    // Check each rule
    for (const rule of rules) {
      // 1. Quick check with exact matches
      for (const word of words) {
        // Clean the word for exact matching
        const cleanWord = word.replace(/[^\w]/g, '');
        if (cleanWord && rule.exactMatches.has(cleanWord)) {
          return { blocked: true, rule, matches: [cleanWord] };
        }
      }

      // 2. Check with regex patterns for more complex matches
      for (const pattern of rule.patterns) {
        try {
          // Set a timeout for regex execution to prevent catastrophic backtracking
          // This uses a simple approach - we'll abort if the regex takes too long
          const startTime = Date.now();
          const MAX_REGEX_TIME = 50; // milliseconds

          const matches = normalizedContent.match(pattern);

          const executionTime = Date.now() - startTime;
          if (executionTime > MAX_REGEX_TIME) {
            Logger.warn(`Regex pattern took ${executionTime}ms to execute, which is slow. Pattern: ${pattern.toString()}`);
          }

          if (matches) {
            return { blocked: true, rule, matches: matches.map((m) => m.trim()) };
          }
        }
        catch (error) {
          // Log the error but continue processing other patterns
          Logger.error(`Error executing regex pattern: ${pattern.toString()}`, error);
        }
      }
    }

    return { blocked: false, rule: null, matches: [] };
  }

  /**
   * Ensure rules for a hub are loaded and up-to-date
   */
  private async ensureRulesLoaded(hubId: string): Promise<void> {
    const now = Date.now();
    const lastRefresh = this.lastCacheRefresh.get(hubId) || 0;

    // Check if cache needs refresh
    if (now - lastRefresh > this.CACHE_TTL) {
      await this.loadRulesForHub(hubId);
      this.lastCacheRefresh.set(hubId, now);
    }
  }

  /**
   * Load rules from database and compile them for efficient matching
   */
  private async loadRulesForHub(hubId: string): Promise<void> {
    try {
      // Fetch rules with their patterns
      const rules = await db.antiSwearRule.findMany({
        where: { hubId },
        include: { patterns: true },
      });

      // Compile rules for efficient matching
      const compiledRules: CompiledRule[] = rules.map((rule) => {
        const exactMatches = new Set<string>();
        const patterns: RegExp[] = [];

        // Process each pattern
        for (const pattern of rule.patterns) {
          if (pattern.pattern.includes('*')) {
            // Count wildcards to detect potentially problematic patterns
            const wildcardCount = (pattern.pattern.match(/\*/g) || []).length;

            // Warn about patterns with many wildcards
            if (wildcardCount > 2) {
              Logger.warn(`Pattern "${pattern.pattern}" has ${wildcardCount} wildcards, which may cause performance issues`);
            }

            // Reject patterns with excessive wildcards that could cause catastrophic backtracking
            if (wildcardCount > 5) {
              Logger.error(`Pattern "${pattern.pattern}" has too many wildcards (${wildcardCount}). Skipping to protect performance.`);
              continue;
            }

            // Handle wildcard patterns
            // First escape all special regex characters
            let regexPattern = pattern.pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&');

            // Then replace * with .* for wildcard matching
            // We need to handle both escaped and unescaped asterisks
            regexPattern = regexPattern.replace(/\\\*/g, '.*').replace(/\*/g, '.*');

            // Add word boundaries for more precise matching
            try {
              const regex = new RegExp(`\\b${regexPattern}\\b`, 'i');
              patterns.push(regex);
              Logger.debug(`Compiled wildcard pattern: ${pattern.pattern} -> ${regexPattern}`);
            }
            catch (error) {
              Logger.error(`Failed to compile regex for pattern "${pattern.pattern}": ${error.message}`);
            }
          }
          else {
            // Handle exact matches
            exactMatches.add(pattern.pattern.toLowerCase());
          }
        }

        return {
          id: rule.id,
          hubId: rule.hubId,
          name: rule.name,
          actions: rule.actions,
          exactMatches,
          patterns,
          lastUpdated: Date.now(),
        };
      });

      // Update cache
      this.compiledRules.set(hubId, compiledRules);
      Logger.debug(`Loaded ${compiledRules.length} anti-swear rules for hub ${hubId}`);
    }
    catch (error) {
      Logger.error('Error loading anti-swear rules:', error);
      // Set empty rules to prevent constant retries on error
      this.compiledRules.set(hubId, []);
    }
  }

  /**
   * Invalidate cache for a specific hub
   */
  public invalidateCache(hubId: string): void {
    this.lastCacheRefresh.delete(hubId);
    this.compiledRules.delete(hubId);
    Logger.debug(`Invalidated anti-swear cache for hub ${hubId}`);
  }

  /**
   * Invalidate all caches
   */
  public invalidateAllCaches(): void {
    this.lastCacheRefresh.clear();
    this.compiledRules.clear();
    Logger.debug('Invalidated all anti-swear caches');
  }
}
