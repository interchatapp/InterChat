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

import type { Hub, Prisma, User } from '#src/generated/prisma/client/client.js';
import { showRulesScreening } from '#src/interactions/RulesScreening.js';
import HubManager from '#src/managers/HubManager.js';
import { CallService } from '#src/services/CallService.js';
import { RedisKeys } from '#src/utils/Constants.js';
import db from '#src/utils/Db.js';
import { updateLeaderboards } from '#src/utils/Leaderboard.js';
import Logger from '#src/utils/Logger.js';
import { runCallChecks, runChecks } from '#src/utils/network/runChecks.js';
import { getRedis } from '#src/utils/Redis.js';
import { fetchUserData, getOrCreateWebhook, handleError } from '#src/utils/Utils.js';
import type { Client, GuildTextBasedChannel, Message } from 'discord.js';
import { BroadcastService } from './BroadcastService.js';
import { ConvertDatesToString } from '#src/types/Utils.js';

/**
 * Result of processing a message in a hub channel
 */
type MessageProcessingResult = { handled: false; hub: null } | { handled: true; hub: HubManager };

export type RequiredConnectionData = {
  id: string;
  channelId: string;
  connected: boolean;
  compact: boolean;
  webhookURL: string;
  parentId: string | null;
  hubId: string;
  embedColor: string | null;
  serverId: string;
  lastActive: Date;
};

/**
 * Data structure returned when retrieving hub and connections
 */
export interface HubConnectionData {
  hub: HubManager;
  connection: RequiredConnectionData;
  hubConnections: RequiredConnectionData[];
}

/**
 * Processes messages for both hub channels and call channels
 */
export class MessageProcessor {
  private readonly broadcastService: BroadcastService;
  private readonly callService: CallService;

  // Redis cache manager
  private static readonly redis = getRedis();
  private static readonly REDIS_CACHE_TTL = 300; // 5 minutes in seconds

  /**
   * Creates a new MessageProcessor instance
   * @param client Discord client instance
   */
  constructor(client: Client) {
    this.broadcastService = new BroadcastService();
    this.callService = new CallService(client);
  }

  /**
   * Invalidates the cache for a specific channel
   * @param channelId The channel ID to invalidate cache for
   */
  static async invalidateCache(channelId: string): Promise<void> {
    // Clear Redis cache for this channel
    const cacheKeys = await MessageProcessor.redis.keys(
      `${RedisKeys.Hub}:connections:${channelId}`,
    );

    if (cacheKeys.length > 0) {
      await MessageProcessor.redis.del(...cacheKeys);
    }

    Logger.debug(`Invalidated cache for channel ${channelId}`);
  }

  /**
   * Hooks into connection updates to invalidate cache
   * This should be called whenever a connection is updated or deleted
   * @param channelId The channel ID of the connection that was modified
   */
  static async onConnectionModified(channelId: string): Promise<void> {
    await MessageProcessor.invalidateCache(channelId);
  }

  static convertConnectionDates(
    connection: ConvertDatesToString<RequiredConnectionData>,
  ): RequiredConnectionData {
    return {
      ...connection,
      lastActive: new Date(connection.lastActive),
    };
  }

  static parseHubDates<
    T extends
      | Hub
      | (Hub & { connections: RequiredConnectionData[]; rulesAcceptances: { acceptedAt: Date }[] }),
  >(hub: ConvertDatesToString<T>): T {
    const data = {
      ...hub,
      createdAt: new Date(hub.createdAt),
      updatedAt: new Date(hub.updatedAt),
      lastActive: new Date(hub.lastActive),
      rulesAcceptances:
        'rulesAcceptances' in hub
          ? hub.rulesAcceptances.map((acceptance) => ({
            ...acceptance,
            acceptedAt: new Date(acceptance.acceptedAt),
          }))
          : [],
      connections:
        'connections' in hub ? hub.connections.map(MessageProcessor.convertConnectionDates) : [],
    } as T;

    return data;
  }

  /**
   * Retrieves hub and connection data for a given channel and user
   * @param channelId The channel ID to get hub data for
   * @returns Hub and connection data or null if not found
   */
  static async getHubAndConnections(channelId: string): Promise<HubConnectionData | null> {
    const startTime = performance.now();

    // Create a cache key
    const redisKey = `${RedisKeys.Hub}:connections:${channelId}`;

    // Check Redis cache first
    const redisStartTime = performance.now();
    const cachedData = await MessageProcessor.redis.get(redisKey);
    Logger.debug(`Redis get took ${performance.now() - redisStartTime}ms for ${channelId}`);

    // If we have a cache hit, use the cached data directly
    if (cachedData) {
      const cacheHitStartTime = performance.now();
      try {
        // Parse the cached data
        const cached = JSON.parse(cachedData);

        if (cached && cached.data) {
          // Create manager objects from the cached raw data
          const connection = cached.data.connection as ConvertDatesToString<RequiredConnectionData>;
          const hub = cached.data.hub;

          if (connection && hub) {
            // Create the result object
            const result: HubConnectionData = {
              hub: new HubManager(MessageProcessor.parseHubDates(hub)),
              connection: MessageProcessor.convertConnectionDates(connection),
              hubConnections: cached.data.hubConnections.map(
                MessageProcessor.convertConnectionDates,
              ),
            };

            Logger.debug(
              `Cache hit processing took ${performance.now() - cacheHitStartTime}ms for ${channelId}`,
            );
            Logger.debug(
              `Total getHubAndConnections took ${performance.now() - startTime}ms for ${channelId} (cache hit)`,
            );
            return result;
          }
        }

        // If we get here, the cached data is invalid
        // Remove it from cache
        await MessageProcessor.redis.del(redisKey);
        Logger.debug(
          `Invalid cache data processing took ${performance.now() - cacheHitStartTime}ms for ${channelId}`,
        );
      }
      catch (error) {
        // If there's an error parsing the cached data, log it and continue to fetch
        Logger.error('Error parsing cached hub connection data:', error);
        // Remove invalid data from cache
        await MessageProcessor.redis.del(redisKey);
        Logger.debug(
          `Error cache processing took ${performance.now() - cacheHitStartTime}ms for ${channelId}`,
        );
      }
    }

    // Cache miss - fetch from database
    const connectionSelect = {
      id: true,
      channelId: true,
      connected: true,
      compact: true,
      webhookURL: true,
      parentId: true,
      hubId: true,
      embedColor: true,
      serverId: true,
      lastActive: true,
    } as Prisma.ConnectionSelect;

    const dbFetchStartTime = performance.now();
    const connection = await db.connection.findFirst({
      where: { channelId, connected: true },
      select: {
        ...connectionSelect,
        hub: {
          include: {
            connections: {
              where: { connected: true, channelId: { not: channelId } },
              select: connectionSelect,
            },
          },
        },
      },
    });

    Logger.debug(`Database fetch took ${performance.now() - dbFetchStartTime}ms for ${channelId}`);

    if (!connection || !connection.hub) {
      Logger.debug(
        `Total getHubAndConnections took ${performance.now() - startTime}ms for ${channelId} (no connection found)`,
      );
      return null;
    }

    // Create the result object
    const createManagersStartTime = performance.now();
    const result: HubConnectionData = {
      hub: new HubManager(connection.hub),
      connection,
      hubConnections: connection.hub.connections,
    };
    Logger.debug(
      `Creating managers took ${performance.now() - createManagersStartTime}ms for ${channelId}`,
    );

    // Store in Redis cache with TTL
    const setCacheStartTime = performance.now();
    await MessageProcessor.redis.set(
      redisKey,
      JSON.stringify({
        timestamp: performance.now(),
        data: {
          // Store the raw data that can be serialized
          connection,
          hub: connection.hub,
          hubConnections: connection.hub.connections,
        },
      }),
      'EX',
      MessageProcessor.REDIS_CACHE_TTL,
    );
    Logger.debug(`Setting cache took ${performance.now() - setCacheStartTime}ms for ${channelId}`);

    Logger.debug(
      `Total getHubAndConnections took ${performance.now() - startTime}ms for ${channelId} (cache miss)`,
    );
    return result;
  }

  /**
   * Processes a message sent in a hub channel
   * @param message The Discord message to process
   * @returns Result indicating if the message was handled and the associated hub
   */
  async processHubMessage(message: Message<true>): Promise<MessageProcessingResult> {
    try {
      // Start performance tracking
      const startTime = performance.now();
      const timings: Record<string, number> = {};

      // Get hub and connection data for this channel
      const hubStartTime = performance.now();
      const hubAndConnections = await MessageProcessor.getHubAndConnections(message.channelId);
      timings.getHubAndConnections = performance.now() - hubStartTime;

      if (!hubAndConnections) return { handled: false, hub: null };
      const { hub, hubConnections, connection } = hubAndConnections;

      // Ensure webhook URL is set (if connected through dashboard it might not be)
      if (connection.webhookURL.length < 1) {
        const webhookStartTime = performance.now();
        await this.setConnectionWebhookURL(connection, message.channel);
        timings.setConnectionWebhookURL = performance.now() - webhookStartTime;
      }

      // Get user data for rules checking and other operations - this is now cached
      const userDataStartTime = performance.now();
      const userData = await fetchUserData(message.author.id);
      timings.fetchUserData = performance.now() - userDataStartTime;

      // Check if user has accepted the bot's global rules
      const botRulesStartTime = performance.now();
      const botRulesAccepted = await this.checkBotRulesAcceptance(message, userData);
      timings.checkBotRulesAcceptance = performance.now() - botRulesStartTime;

      if (!botRulesAccepted) {
        return { handled: false, hub: null };
      }

      // Check if user has accepted the hub's specific rules
      const hubRulesStartTime = performance.now();
      const hubRulesAccepted = await this.checkHubRulesAcceptance(message, userData, hub);
      timings.checkHubRulesAcceptance = performance.now() - hubRulesStartTime;

      if (!hubRulesAccepted) {
        return { handled: false, hub: null };
      }

      // Resolve any attachments in the message
      const attachmentStartTime = performance.now();
      const attachmentURL = await this.broadcastService.resolveAttachmentURL(message);
      timings.resolveAttachmentURL = performance.now() - attachmentStartTime;

      // Run all message checks (ban, blacklist, NSFW, anti-swear, etc.)
      const checksStartTime = performance.now();
      const checksResult = await this.runMessageChecks(
        message,
        hub,
        userData,
        attachmentURL,
        hubConnections.length,
      );
      timings.runMessageChecks = performance.now() - checksStartTime;

      if (!checksResult) {
        // Log performance metrics for failed checks
        const totalTime = performance.now() - startTime;
        Logger.debug(`Message ${message.id} processing failed at checks stage (${totalTime}ms)`);
        Logger.debug('Timings: %O', timings);
        return { handled: false, hub: null };
      }

      // Indicate typing in the channel to show the message is being processed
      message.channel.sendTyping().catch(() => null);

      const broadcastStartTime = performance.now();

      // Broadcast the message to all connected channels
      await this.broadcastService.broadcastMessage(
        message,
        hub,
        hubConnections,
        connection,
        attachmentURL,
        userData,
      );

      timings.broadcastMessage = performance.now() - broadcastStartTime;

      // Update leaderboards and metrics
      const statsStartTime = performance.now();
      this.updateStatsAfterBroadcast(message, hub);
      timings.updateStatsAfterBroadcast = performance.now() - statsStartTime;

      // Log performance metrics
      const totalTime = performance.now() - startTime;
      Logger.debug(`Message ${message.id} processed successfully in ${totalTime}ms`);
      Logger.debug(`Timings: ${JSON.stringify(timings)}`);

      return { handled: true, hub };
    }
    catch (error) {
      handleError(error, { comment: 'Error processing hub message' });
      return { handled: false, hub: null };
    }
  }

  /**
   * Checks if a user has accepted the bot's global rules
   * @param message The Discord message
   * @param userData The user's data from the database
   * @returns Whether the user has accepted the rules
   */
  private async checkBotRulesAcceptance(
    message: Message<true>,
    userData: User | null,
  ): Promise<boolean> {
    if (!userData?.acceptedRules) {
      await showRulesScreening(message, userData);
      return false;
    }
    return true;
  }

  /**
   * Checks if a user has accepted the hub's rules
   * @param message The Discord message
   * @param userData The user's data from the database
   * @param hub The hub manager instance
   * @returns Whether the user has accepted the hub rules or if no rules exist
   */
  private async checkHubRulesAcceptance(
    message: Message<true>,
    userData: User | null,
    hub: HubManager,
  ): Promise<boolean> {
    const redis = getRedis();
    const acceptedKey = `${RedisKeys.HubRules}:accepted:${hub.id}:${message.author.id}`;
    const cachedAccepted = await redis.get(acceptedKey);
    if (cachedAccepted === '1') return true;

    const accepted = await db.hubRulesAcceptance.findFirst({
      where: { hubId: hub.id, userId: message.author.id },
    });

    // If the user has accepted the rules or there are no rules, return true
    if (accepted || hub.getRules().length === 0) {
      // show accepted state
      await redis.set(
        `${RedisKeys.HubRules}:accepted:${hub.id}:${message.author.id}`,
        '1',
        'EX',
        300,
      );
      return true;
    }

    // Check if we've recently shown the rules to this user (cooldown)
    const rulesShownKey = `${RedisKeys.HubRules}:shown:${hub.id}:${message.author.id}`;
    const rulesShown = await redis.get(rulesShownKey);

    if (rulesShown) return false;

    // Set a cooldown of 5 minutes to prevent spam
    await redis.set(rulesShownKey, '1', 'EX', 300);
    await showRulesScreening(message, userData, hub);
    return false;
  }

  /**
   * Runs all message checks for hub messages
   * @param message The Discord message
   * @param hub The hub manager instance
   * @param userData The user's data from the database
   * @param attachmentURL URL of any attachment in the message
   * @param connectionCount Number of connections in the hub
   * @returns Whether the message passed all checks
   */
  private async runMessageChecks(
    message: Message<true>,
    hub: HubManager,
    userData: User | null,
    attachmentURL: string | undefined,
    connectionCount: number,
  ): Promise<boolean> {
    // If userData is null, we can't run checks
    if (!userData) return false;

    return await runChecks(message, hub, {
      userData,
      settings: hub.settings,
      attachmentURL,
      totalHubConnections: connectionCount + 1,
    });
  }

  /**
   * Updates leaderboards and metrics after a message is broadcast
   * @param message The Discord message
   * @param hub The hub manager instance
   */
  private updateStatsAfterBroadcast(message: Message<true>, hub: HubManager): void {
    updateLeaderboards('user', message.author.id);
    updateLeaderboards('server', message.guildId);
    message.client.shardMetrics.incrementMessage(hub.data.name);
  }

  /**
   * Sets the webhook URL for a connection if it's not already set
   * @param connection The connection manager instance
   * @param channel The Discord channel
   * @returns Result of the operation or void if successful
   */
  private async setConnectionWebhookURL(
    connection: RequiredConnectionData,
    channel: GuildTextBasedChannel,
  ): Promise<MessageProcessingResult | void> {
    try {
      const webhook = await getOrCreateWebhook(channel);
      if (!webhook) return { handled: false, hub: null };

      await db.connection.update({
        where: { id: connection.id },
        data: { webhookURL: webhook.url },
      });
    }
    catch (error) {
      handleError(error, { comment: 'Failed to set webhook URL' });
      return { handled: false, hub: null };
    }
  }

  /**
   * Processes a message sent in a call channel
   * @param message The Discord message to process
   * @returns Whether the message was successfully processed and sent
   */
  async processCallMessage(message: Message<true>): Promise<boolean> {
    try {
      // Start performance tracking
      const startTime = performance.now();
      const timings: Record<string, number> = {};

      // Get active call data and user data in parallel
      const parallelStartTime = performance.now();
      const [activeCall, userData] = await Promise.all([
        this.callService.getActiveCallData(message.channelId),
        fetchUserData(message.author.id),
      ]);
      timings.getParallelData = performance.now() - parallelStartTime;

      // Validate call and user data
      if (!activeCall || !userData) {
        Logger.debug(
          `Call message processing failed: ${!activeCall ? 'No active call' : 'No user data'}`,
        );
        return false;
      }

      // Check if user has accepted the bot's rules
      if (!userData.acceptedRules) {
        const rulesStartTime = performance.now();
        await showRulesScreening(message, userData);
        timings.showRulesScreening = performance.now() - rulesStartTime;
        return false;
      }

      // Track this user as a participant in the call
      const participantStartTime = performance.now();
      await this.callService.addParticipant(message.channelId, message.author.id);
      timings.addParticipant = performance.now() - participantStartTime;

      // Find the other participant to send the message to
      const otherParticipant = activeCall.participants.find(
        (p) => p.channelId !== message.channelId,
      );

      if (!otherParticipant) {
        Logger.debug('No other participant found in call');
        return false;
      }

      const attachmentURL = message.attachments.first()?.url;

      // Run call-specific checks (spam, URLs, GIFs, NSFW, etc.)
      const checksStartTime = performance.now();
      const checksPassed = await runCallChecks(message, {
        userData,
        attachmentURL,
      });
      timings.runCallChecks = performance.now() - checksStartTime;

      if (!checksPassed) {
        // Log performance metrics for failed checks
        const totalTime = performance.now() - startTime;
        Logger.debug(
          `Call message ${message.id} processing failed at checks stage (${totalTime}ms)`,
        );
        Logger.debug(`Timings: ${JSON.stringify(timings)}`);
        return false;
      }

      // Send the message to the other participant
      const webhookStartTime = performance.now();
      await BroadcastService.sendMessage(otherParticipant.webhookUrl, {
        content: message.content,
        username: message.author.username,
        avatarURL: message.author.displayAvatarURL(),
        allowedMentions: { parse: [] },
      });
      timings.sendWebhook = performance.now() - webhookStartTime;

      // Update call participation after successful message send
      const updateStartTime = performance.now();
      await this.callService.updateCallParticipant(message.channelId, message.author.id);
      timings.updateCallParticipant = performance.now() - updateStartTime;

      // Log performance metrics
      const totalTime = performance.now() - startTime;
      Logger.debug(`Call message ${message.id} processed successfully in ${totalTime}ms`);
      Logger.debug(`Timings: ${JSON.stringify(timings)}`);

      return true;
    }
    catch (error) {
      handleError(error, { comment: 'Failed to process call message' });
      return false;
    }
  }
}
