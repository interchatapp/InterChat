// @ts-check
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient as MongoPrismaClient } from '../build/generated/prisma-mongo/client/client.js';
import { PrismaClient as PostgresPrismaClient } from '../build/generated/prisma/client/client.js';
import { Spinner, greenText, redText } from './utils.js';

// Ensure we have both MongoDB and PostgreSQL connection strings
if (!process.env.MONGODB_URL) {
  throw new Error('Missing MONGODB_URL environment variable');
}

if (!process.env.DATABASE_URL) {
  throw new Error('Missing DATABASE_URL environment variable');
}

// Initialize clients with explicit datasource URLs to avoid env conflicts
// Also disable loading of .env files to prevent conflicts
const mongoClient = new MongoPrismaClient({
  errorFormat: 'minimal',
});

const postgresClient = new PostgresPrismaClient({
  errorFormat: 'minimal',
});

// Disable Prisma's .env loading warning
process.env.PRISMA_DISABLE_WARNINGS = '1';

// Helper to create a delay to avoid overwhelming the database
/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @typedef {Object} MigrationContext
 * @property {function} log - Function to log messages
 * @property {fs.WriteStream} logStream - Stream to write logs to file
 */

/**
 * Configuration for each model migration
 * @typedef {Object} ModelConfig
 * @property {string} name - Display name of the model
 * @property {string} mongoModel - Name of the MongoDB model
 * @property {string} postgresModel - Name of the PostgreSQL model
 * @property {number} batchSize - Number of records to process in each batch
 * @property {function} [transform] - Optional function to transform data before saving
 * @property {function} [getDisplayName] - Optional function to get a display name for the record
 */

/**
 * Generic function to migrate data from MongoDB to PostgreSQL
 * @param {MigrationContext} context - The migration context
 * @param {ModelConfig} config - Configuration for this model
 */
async function migrateModel({ log }, config) {
  const {
    name,
    mongoModel,
    postgresModel,
    batchSize = 1000, // Increased batch size for better performance
    transform = (/** @type {any} */ record) => record,
    getDisplayName = (/** @type {any} */ record) => record.id,
  } = config;

  // Get the MongoDB model client
  const mongoModelClient = mongoClient[mongoModel];
  if (!mongoModelClient) {
    log(`Error: MongoDB model ${mongoModel} not found\n`);
    return { successCount: 0, errorCount: 0, totalCount: 0 };
  }

  // Get the PostgreSQL model client
  const postgresModelClient = postgresClient[postgresModel];
  if (!postgresModelClient) {
    log(`Error: PostgreSQL model ${postgresModel} not found\n`);
    return { successCount: 0, errorCount: 0, totalCount: 0 };
  }

  // Count total records first
  const totalCount = await mongoModelClient.count();
  log(`Found ${totalCount} ${name.toLowerCase()} to migrate`);

  let successCount = 0;
  let errorCount = 0;
  let processedCount = 0;

  // Process in batches
  while (processedCount < totalCount) {
    log(
      `Migrating ${name} batch: ${processedCount + 1}-${Math.min(processedCount + batchSize, totalCount)} of ${totalCount}`,
    );

    // Fetch a batch of records
    let records = await mongoModelClient
      .findMany({
        take: batchSize,
        skip: processedCount,
      })
      .catch((/** @type {Error} */ e) => {
        console.error(`Error fetching ${name} batch:`, e);
        return [];
      });

    if (mongoModel === 'hub') {
      const users = await mongoClient.user.findMany({
        where: { id: { in: records.map((/** @type {any} */ r) => r.ownerId) } },
      });

      records = records.filter((/** @type {any} */ record) => {
        const isValid = users.some((/** @type {any} */ u) => u.id === record.ownerId);
        if (!isValid) {
          log(
            `Skipping hub ${record.id} (${record.name}) - Referenced owner ${record.ownerId} not found\n`,
          );
        }
        return isValid;
      });
    } else if (mongoModel === 'connection') {
      // Get all valid server IDs from PostgreSQL
      const validServerIds = await postgresClient.serverData.findMany({
        select: { id: true },
      });
      const serverIdSet = new Set(validServerIds.map((s) => s.id));

      // Get all valid hub IDs from PostgreSQL
      const validHubIds = await postgresClient.hub.findMany({
        select: { id: true },
      });
      const hubIdSet = new Set(validHubIds.map((h) => h.id));

      // Filter out connections with invalid server or hub IDs
      records = records.filter((/** @type {any} */ record) => {
        const isValid = serverIdSet.has(record.serverId) && hubIdSet.has(record.hubId);
        if (!isValid) {
          log(`Skipping connection ${record.id} - Referenced server or hub not found\n`);
        }
        return isValid;
      });
    } else if (mongoModel === 'infraction') {
      // Get all valid hub IDs from PostgreSQL
      const validHubIds = await postgresClient.hub.findMany({
        select: { id: true },
      });
      const validUsers = await postgresClient.user.findMany({
        select: { id: true },
      });
      const validServers = await postgresClient.serverData.findMany({
        select: { id: true },
      });

      const hubIdSet = new Set(validHubIds.map((h) => h.id));
      const userIdSet = new Set(validUsers.map((m) => m.id));
      const serverIdSet = new Set(validServers.map((s) => s.id));

      records = records.filter(
        (
          /** @type {import('../build/generated/postgres-prisma/client/client.d.ts').Infraction} */ record,
        ) => {
          const isValid =
            hubIdSet.has(record.hubId) &&
            userIdSet.has(record.moderatorId) &&
            (record.serverId ? serverIdSet.has(record.serverId) : true) &&
            (record.userId ? userIdSet.has(record.userId) : true);

          if (record.userId && !userIdSet.has(record.userId)) {
            log(`Skipping infraction ${record.id} - Referenced user ${record.userId} not found\n`);
            return false;
          }

          if (!isValid)
            log(`Skipping infraction ${record.id} - Referenced hub or moderator not found\n`);
          return isValid;
        },
      );
    } else if (mongoModel === 'hubModerator') {
      // Get all valid hub IDs from PostgreSQL
      const validHubIds = await postgresClient.hub.findMany({
        select: { id: true },
      });
      const hubIdSet = new Set(validHubIds.map((h) => h.id));

      // Get all valid user IDs from PostgreSQL
      const validUserIds = await postgresClient.user.findMany({
        select: { id: true },
      });
      const userIdSet = new Set(validUserIds.map((u) => u.id));

      records = records.filter((/** @type {any} */ record) => {
        const isValid = hubIdSet.has(record.hubId) && userIdSet.has(record.userId);
        if (!isValid) {
          log(
            `Skipping hub moderator ${record.id} - Referenced hub ${record.hubId} or user ${record.userId} not found\n`,
          );
        }
        return isValid;
      });
    } else if (mongoModel === 'hubUpvote' || mongoModel === 'hubRulesAcceptance') {
      // Get all valid hub IDs from PostgreSQL
      const validHubIds = await postgresClient.hub.findMany({
        select: { id: true },
      });
      const validUserIds = await postgresClient.user.findMany({
        select: { id: true },
      });

      const hubIdSet = new Set(validHubIds.map((h) => h.id));
      const userIdSet = new Set(validUserIds.map((u) => u.id));
      records = records.filter((/** @type {any} */ record) => {
        const isValid = userIdSet.has(record.userId) && hubIdSet.has(record.hubId);
        if (!isValid) {
          log(`Skipping hub upvote ${record.id} - Referenced user (${record.userId}) not found\n`);
        }
        return isValid;
      });
    } else if (mongoModel === 'blockWord' || mongoModel === 'hubLogConfig') {
      // Get all valid hub IDs from PostgreSQL
      const validHubIds = await postgresClient.hub.findMany({
        select: { id: true },
      });
      const hubIdSet = new Set(validHubIds.map((h) => h.id));
      records = records.filter((/** @type {any} */ record) => {
        const isValid = hubIdSet.has(record.hubId);
        if (!isValid) {
          log(`Skipping ${mongoModel} ${record.id} - Referenced hub (${record.hubId}) not found\n`);
        }
        return isValid;
      });
    } else if (mongoModel === 'appeal') {
      // Get all valid infraction IDs from PostgreSQL
      const validInfractionIds = await postgresClient.infraction.findMany({
        select: { id: true },
      });
      const infractionIdSet = new Set(validInfractionIds.map((i) => i.id));
      records = records.filter((/** @type {any} */ record) => {
        const isValid = infractionIdSet.has(record.infractionId);
        if (!isValid) {
          log(
            `Skipping appeal ${record.id} - Referenced infraction (${record.infractionId}) not found\n`,
          );
        }
        return isValid;
      });
    }

    if (records.length === 0) break;

    // Transform all records in the batch
    const transformedRecords = records.map((/** @type {any} */ record) => transform(record));

    try {
      // Use createMany for batch insertion with skipDuplicates (this can fail)
      const result = await postgresModelClient.createMany({
        data: transformedRecords,
        skipDuplicates: true,
      });

      successCount += result.count;
      log(`Batch complete: ${result.count} ${name.toLowerCase()} migrated successfully`);
    } catch (error) {
      // If batch insert fails, fall back to individual inserts
      log(`Batch insert failed, falling back to individual inserts: ${error.message}`);

      // Log more details about the error
      console.error('Error details:', error);

      // Process records individually when batch fails
      for (const record of transformedRecords) {
        try {
          await postgresModelClient.upsert({
            where: { id: record.id },
            update: {},
            create: record,
          });
          successCount++;
        } catch (err) {
          errorCount++;
          log(`Error migrating ${name.toLowerCase()} ${getDisplayName(record)}: ${err.message}`);

          // Log more details about the record and error
          console.error(`Failed record (${name}):`, record);
          console.error('Error details:', err);
        }
      }
    }

    processedCount += records.length;
    log(`Progress: ${processedCount}/${totalCount} ${name.toLowerCase()} processed`);

    // Brief pause between batches to avoid overwhelming the database
    await sleep(500);
  }

  log(`Migrated ${successCount} ${name.toLowerCase()} successfully, ${errorCount} errors`);
  return { successCount, errorCount, totalCount };
}

// Model configurations
const modelConfigs = [
  {
    name: 'Users',
    mongoModel: 'user',
    postgresModel: 'user',
    batchSize: 5000, // Large batch for users
  },
  {
    name: 'Servers',
    mongoModel: 'serverData',
    postgresModel: 'serverData',
    batchSize: 500,
  },
  {
    name: 'Hubs',
    mongoModel: 'hub',
    postgresModel: 'hub',
    batchSize: 500,
    getDisplayName: (/** @type {any} */ hub) => hub.name || hub.id,
    transform: (/** @type {any} */ hub) => {
      // Check if settings is too large for PostgreSQL INT4
      if (typeof hub.settings === 'number' && hub.settings > 2147483647) {
        console.log(`Converting large settings value for hub ${hub.id}: ${hub.settings} -> 0`);
        return { ...hub, settings: 0 };
      }
      return hub;
    },
  },
  {
    name: 'Connections',
    mongoModel: 'connection',
    postgresModel: 'connection',
    batchSize: 200, // Reduced batch size for better error handling
    transform: (
      /** @type {import('../build/generated/prisma/client/client.d.ts').Connection} */ connection,
    ) => ({
      ...connection,
      joinRequestsDisabled: connection.joinRequestsDisabled ?? false,
    }),
  },
  {
    name: 'HubModerators',
    mongoModel: 'hubModerator',
    postgresModel: 'hubModerator',
    batchSize: 100,
  },
  {
    name: 'Infractions',
    mongoModel: 'infraction',
    postgresModel: 'infraction',
    batchSize: 1000,
  },
  {
    name: 'Appeals',
    mongoModel: 'appeal',
    postgresModel: 'appeal',
    batchSize: 2000,
  },
  {
    name: 'HubUpvotes',
    mongoModel: 'hubUpvote',
    postgresModel: 'hubUpvote',
    batchSize: 40,
  },
  {
    name: 'HubReviews',
    mongoModel: 'hubReview',
    postgresModel: 'hubReview',
    batchSize: 2000,
  },
  {
    name: 'BlockWords',
    mongoModel: 'blockWord',
    postgresModel: 'blockWord',
    batchSize: 30,
  },
  {
    name: 'HubRulesAcceptances',
    mongoModel: 'hubRulesAcceptance',
    postgresModel: 'hubRulesAcceptance',
    batchSize: 5000,
  },
  {
    name: 'HubLogConfigs',
    mongoModel: 'hubLogConfig',
    postgresModel: 'hubLogConfig',
    transform: (
      /** @type {import('../build/generated/prisma-mongo/client/client.d.ts').HubLogConfig} */ config,
    ) => {
      // use new format
      /** @type {import('../build/generated/prisma/client/client.d.ts').HubLogConfig} */
      const newConfig = {
        appealsChannelId: config.appeals?.channelId ?? null,
        appealsRoleId: config.appeals?.roleId ?? null,
        modLogsChannelId: config.modLogs?.channelId ?? null,
        modLogsRoleId: config.modLogs?.roleId ?? null,
        joinLeavesChannelId: config.joinLeaves?.channelId ?? null,
        joinLeavesRoleId: config.joinLeaves?.roleId ?? null,
        networkAlertsChannelId: config.networkAlerts?.channelId ?? null,
        networkAlertsRoleId: config.networkAlerts?.roleId ?? null,
        reportsChannelId: config.reports?.channelId ?? null,
        reportsRoleId: config.reports?.roleId ?? null,
        hubId: config.hubId,
        id: config.id,
      };
      return newConfig;
    },
    batchSize: 1000,
  },
];

/**
 * Test database connections
 * @returns {Promise<boolean>}
 */
async function testDatabaseConnections() {
  try {
    // Test MongoDB connection
    console.log('Testing MongoDB connection...');
    await mongoClient.$connect();
    console.log('MongoDB connection successful!');

    // Test PostgreSQL connection
    console.log('Testing PostgreSQL connection...');
    await postgresClient.$connect();
    console.log('PostgreSQL connection successful!');

    return true;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  } finally {
    // Disconnect to reset connections
    await mongoClient.$disconnect();
    await postgresClient.$disconnect();
  }
}

// Main migration function
async function migrateData() {
  const spinner = new Spinner();
  console.log('Starting migration from MongoDB to PostgreSQL...');

  try {
    // Test database connections first
    spinner.edit('Testing database connections...');
    const connectionsOk = await testDatabaseConnections();
    if (!connectionsOk) {
      throw new Error(
        'Database connection test failed. Please check your connection strings and try again.',
      );
    }
    spinner.stop();

    // Create a log directory if it doesn't exist
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir);
    }

    const logStream = fs.createWriteStream(path.join(logDir, `migration-${Date.now()}.log`));
    /**
     * Log a message to the console and log file
     * @param {string} message - The message to log
     * @param {boolean} [exit] - Whether to stop the spinner
     */
    const log = (message, exit) => {
      const timestamp = new Date().toISOString();
      const formattedMessage = `[${timestamp}] ${message}\n`;
      logStream.write(formattedMessage);
      if (exit) spinner.stop(message);
      else spinner.edit(message);
    };

    // Create context object to pass to migration functions
    const context = { log, logStream };

    // Run migrations in sequence
    const results = {};

    for (const config of modelConfigs) {
      try {
        spinner.start(`Migrating ${config.name}...`);
        results[config.name.toLowerCase()] = await migrateModel(context, config);
        spinner.stop(`Finished Migrating ${config.name}!`);
      } catch (modelError) {
        log(`Error migrating ${config.name}: ${modelError.message}`);
        console.error(`Error details for ${config.name}:`, modelError);
        // Continue with next model instead of failing the entire migration
        results[config.name.toLowerCase()] = {
          successCount: 0,
          errorCount: 0,
          totalCount: 0,
          error: modelError.message,
        };
      }
    }

    // Log summary
    log('Migration Summary:');
    for (const [modelName, result] of Object.entries(results)) {
      log(
        `${modelName}: ${result.successCount} migrated, ${result.errorCount} errors${result.error ? ` (${result.error})` : ''}`,
      );
    }

    spinner.stop(greenText('✓ Migration completed successfully!'));
    log('Migration completed successfully!');
    logStream.end();
  } catch (error) {
    spinner.stop(redText(`✘ Migration failed: ${error.message}`));
    console.error(error);
  } finally {
    // Close database connections
    await mongoClient.$disconnect();
    await postgresClient.$disconnect();
  }
}

// Run the migration
migrateData().catch(console.error);
