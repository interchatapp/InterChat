#!/usr/bin/env node
// @ts-check

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

import db from '../build/utils/Db.js';
import Logger from '../build/utils/Logger.js';
import { sanitizeWords } from '../build/utils/moderation/antiSwear.js';

/**
 * Migrates data from the old BlockWord model to the new AntiSwearRule and AntiSwearPattern models
 * for the improved anti-swear system
 */
async function migrateAntiSwearRules() {
  try {
    Logger.info('Starting migration of anti-swear rules to the improved system...');

    // Get all existing rules
    const oldRules = await db.blockWord.findMany();
    Logger.info(`Found ${oldRules.length} old anti-swear rules to migrate to the improved system`);

    let successCount = 0;
    let errorCount = 0;

    for (const oldRule of oldRules) {
      try {
        // Create new rule
        const newRule = await db.antiSwearRule.create({
          data: {
            hubId: oldRule.hubId,
            name: oldRule.name,
            createdBy: oldRule.createdBy,
            actions: oldRule.actions,
            createdAt: oldRule.createdAt,
            updatedAt: oldRule.updatedAt,
          },
        });

        // Split words and create patterns
        const words = oldRule.words
          .split(',')
          .map((w) => w.trim())
          .filter((w) => w);

        await db.antiSwearPattern.createMany({
          data: words.map((word) => ({
            ruleId: newRule.id,
            pattern: sanitizeWords(word.replaceAll('.*', '*').replaceAll('\\', '')),
            isRegex: word.includes('*'),
          })),
        });

        successCount++;
        Logger.debug(`Migrated anti-swear rule "${oldRule.name}" with ${words.length} patterns`);
      } catch (error) {
        errorCount++;
        Logger.error(`Failed to migrate anti-swear rule "${oldRule.name}":`, error);
      }
    }

    Logger.info(
      `Anti-swear migration completed: ${successCount} rules migrated successfully, ${errorCount} failed`,
    );
  } catch (error) {
    Logger.error('Anti-swear migration failed:', error);
  }
}

// Run the migration
migrateAntiSwearRules()
  .then(() => {
    Logger.info('Anti-swear migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    Logger.error('Anti-swear migration script failed:', error);
    process.exit(1);
  });
