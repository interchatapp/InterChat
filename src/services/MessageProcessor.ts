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

import { getRandomBlockedMessageResponse } from '#src/config/contentFilter.js';
import type { Hub, User } from '#src/generated/prisma/client/client.js';
import { showRulesScreening } from '#src/interactions/RulesScreening.js';
import { DistributedCallingLibrary } from '#src/lib/userphone/DistributedCallingLibrary.js';
import ContentFilterManager from '#src/managers/ContentFilterManager.js';
import HubManager from '#src/managers/HubManager.js';
import AchievementService from '#src/services/AchievementService.js';
import { CallReplyService } from '#src/services/CallReplyService.js';
import type { ConvertDatesToString } from '#src/types/Utils.d.ts';
import Constants, { RedisKeys } from '#src/utils/Constants.js';
import db from '#src/utils/Db.js';
import { logBlockedMessage } from '#src/utils/hub/logger/ContentFilter.js';
import { updateLeaderboards } from '#src/utils/Leaderboard.js';
import Logger from '#src/utils/Logger.js';
import { runCallChecks } from '#src/utils/network/callChecks.js';
import { runChecks } from '#src/utils/network/runChecks.js';
import { getRedis } from '#src/utils/Redis.js';
import {
  ensureUserExists,
  getOrCreateWebhook,
  handleError,
  updateUserInfoIfChanged,
} from '#src/utils/Utils.js';
import { stripIndents } from 'common-tags';
import { type Client, type GuildTextBasedChannel, type Message } from 'discord.js';
import { BroadcastService } from './BroadcastService.js';

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
  private readonly client: Client;
  private readonly callReplyService: CallReplyService;

  // Redis cache manager
  private static readonly redis = getRedis();

  /**
   * Creates a new MessageProcessor instance
   * @param client Discord client instance
   */
  constructor(client: Client) {
    this.client = client;
    this.broadcastService = new BroadcastService();
    this.callReplyService = new CallReplyService();
  }

  /**
   * Get the distributed calling library instance
   */
  private getDistributedCallingLibrary(): DistributedCallingLibrary | null {
    return this.client.getDistributedCallingLibrary();
  }

  /**
   * Invalidates the cache for a specific channel
   * @param channelId The channel ID to invalidate cache for
   */
  static async invalidateCache(channelId: string): Promise<void> {
    await MessageProcessor.redis.del(`${RedisKeys.Hub}:connections:${channelId}`);
    Logger.debug(`Invalidated cache for channel ${channelId}`);
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
    // 1. Try to get connection data
    const connectionCacheKey = `${RedisKeys.Hub}:connection:${channelId}`;
    const connectionData = await MessageProcessor.redis.get(connectionCacheKey);

    let connection: RequiredConnectionData | null = null;
    let hubId;

    // 2. Process connection data or fetch from database
    if (connectionData) {
      try {
        // Connection cache hit
        connection = MessageProcessor.convertConnectionDates(
          JSON.parse(connectionData) as ConvertDatesToString<RequiredConnectionData>,
        );
        hubId = connection.hubId;
      }
      catch (error) {
        Logger.error(`Error parsing cached connection data for ${channelId}:`, error);
        await MessageProcessor.invalidateConnectionCache(channelId);
      }
    }

    if (!connection) {
      // Connection cache miss - fetch from database

      connection = await db.connection.findFirst({
        where: { channelId, connected: true },
        select: {
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
        },
      });

      if (!connection) {
        return null;
      }

      // Cache the connection data
      await MessageProcessor.redis.set(connectionCacheKey, JSON.stringify(connection), 'EX', 300);

      hubId = connection.hubId;
    }

    // 3. Try to get hub data with connections
    const hubCacheKey = `${RedisKeys.Hub}:data:${hubId}`;
    const hubData = await MessageProcessor.redis.get(hubCacheKey);

    let hub: HubManager | null = null;
    let hubConnections: RequiredConnectionData[] = [];

    // 4. Process hub data or fetch from database
    if (hubData) {
      try {
        // Hub cache hit
        const parsedHub = JSON.parse(hubData) as {
          hub: ConvertDatesToString<Hub>;
          connections: ConvertDatesToString<RequiredConnectionData>[];
        };

        const hubWithDates = MessageProcessor.parseHubDates(parsedHub.hub);
        hub = new HubManager(hubWithDates);

        // Convert dates in all connections
        hubConnections = parsedHub.connections
          .filter((conn) => conn.channelId !== channelId) // Exclude current connection
          .map(MessageProcessor.convertConnectionDates);
      }
      catch (error) {
        Logger.error(`Error parsing cached hub data for ${hubId}:`, error);
        if (hubId) await MessageProcessor.invalidateHubCache(hubId);
      }
    }

    if (!hub) {
      // Hub cache miss - fetch from database
      const [dbHubData, connections] = await Promise.all([
        db.hub.findFirst({ where: { id: hubId } }),
        db.connection.findMany({
          where: { connected: true, hubId },
          select: {
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
          },
        }),
      ]);

      if (!dbHubData) {
        return null;
      }

      hub = new HubManager(dbHubData);
      hubConnections = connections;

      // Cache the hub data
      await MessageProcessor.redis.set(
        hubCacheKey,
        JSON.stringify({
          hub: dbHubData,
          connections: hubConnections,
        }),
        'EX',
        300,
      );
    }

    // 5. Create the final result
    const result: HubConnectionData = {
      hub,
      connection,
      hubConnections: hubConnections.filter((conn) => conn.channelId !== channelId),
    };

    return result;
  }

  // Cache invalidation methods
  static async invalidateConnectionCache(channelId: string): Promise<void> {
    const connectionCacheKey = `${RedisKeys.Hub}:connection:${channelId}`;
    await MessageProcessor.redis.del(connectionCacheKey);
    Logger.debug(`Invalidated connection cache for channel ${channelId}`);
  }

  static async invalidateHubCache(hubId: string): Promise<void> {
    const hubCacheKey = `${RedisKeys.Hub}:data:${hubId}`;
    await MessageProcessor.redis.del(hubCacheKey);
    Logger.debug(`Invalidated hub cache for hub ${hubId}`);
  }

  static async onConnectionModified(channelId: string, hubId?: string): Promise<void> {
    // Always invalidate the connection cache
    await MessageProcessor.invalidateConnectionCache(channelId);

    // If hubId is provided, invalidate the hub cache
    if (hubId) {
      await MessageProcessor.invalidateHubCache(hubId);
    }
    else {
      // If hubId is not provided, try to find it
      const connection = await db.connection.findFirst({
        where: { channelId },
        select: { hubId: true },
      });

      if (connection?.hubId) {
        await MessageProcessor.invalidateHubCache(connection.hubId);
      }
    }
  }
  /**
   * Processes a message sent in a hub channel
   * @param message The Discord message to process
   * @returns Result indicating if the message was handled and the associated hub
   */
  async processHubMessage(message: Message<true>): Promise<MessageProcessingResult> {
    try {
      const hubAndConnections = await MessageProcessor.getHubAndConnections(message.channelId);

      if (!hubAndConnections) return { handled: false, hub: null };
      const { hub, hubConnections, connection } = hubAndConnections;

      // Ensure webhook URL is set (if connected through dashboard it might not be)
      if (connection.webhookURL.length < 1) {
        await this.setConnectionWebhookURL(connection, message.channel);
      }

      // Get user data for rules checking and other operations - this is now cached
      const userData = await ensureUserExists(
        message.author.id,
        message.author.username,
        message.author.avatarURL(),
      );

      // Check if user has accepted the hub's specific rules
      const hubRulesAccepted = await this.checkHubRulesAcceptance(message, userData, hub);

      if (!hubRulesAccepted) {
        return { handled: false, hub: null };
      }

      // Resolve any attachments in the message
      const attachmentURL = await this.broadcastService.resolveAttachmentURL(message);

      // Run all message checks (ban, blacklist, NSFW, anti-swear, etc.)
      const checksResult = await this.runMessageChecks(
        message,
        hub,
        userData,
        attachmentURL,
        hubConnections.length,
      );

      if (!checksResult) {
        return { handled: false, hub: null };
      }

      // Indicate typing in the channel to show the message is being processed
      message.channel.sendTyping().catch(() => null);

      // Check if user seems confused and needs help (before broadcasting)
      await this.checkForConfusedUser(message, hub);

      // Broadcast the message to all connected channels
      await this.broadcastService.broadcastMessage(
        message,
        hub,
        hubConnections,
        connection,
        attachmentURL,
        userData,
      );

      // Update leaderboards and metrics
      this.updateStatsAfterBroadcast(message, {
        name: hub.data.name,
        id: hub.data.id,
        connections: { count: hubConnections.length },
      });

      // Update user info if changed (after successful processing)
      updateUserInfoIfChanged(
        message.author.id,
        message.author.username,
        message.author.avatarURL(),
      ).catch(() => null); // Don't let this fail the whole process

      // Log performance metrics

      return { handled: true, hub };
    }
    catch (error) {
      handleError(error, { comment: 'Error processing hub message' });
      return { handled: false, hub: null };
    }
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
   * Checks if a user seems confused and provides helpful guidance
   * @param message The Discord message
   * @param hub The hub manager instance
   */
  private async checkForConfusedUser(message: Message<true>, hub: HubManager): Promise<void> {
    const content = message.content.toLowerCase().trim();

    // Common phrases that indicate confusion
    const confusedPhrases = [
      'how do i use this bot',
      'how does this bot work',
      'what is this bot',
      'how to use this',
      'what does this do',
      'how does this work',
      'what is interchat',
      'how do i use interchat',
      'what is this',
      'how does this work',
      "i don't understand",
      "what's going on",
      'what is happening',
      'i need help',
      'what am i supposed to do',
      'how does cross chat work',
      'what is cross chat',
      'how to cross chat',
    ];

    // Check if the message contains any confused phrases
    const isConfused = confusedPhrases.some((phrase) => content === phrase);

    if (!isConfused) return;

    // Check cooldown to prevent spam (5 minutes per user per hub)
    const redis = getRedis();
    const cooldownKey = `confused_help:${hub.id}:${message.author.id}`;
    const cooldown = await redis.get(cooldownKey);

    if (cooldown) return; // User was already helped recently

    // Set cooldown
    await redis.set(cooldownKey, '1', 'EX', 300); // 5 minutes

    const messageContent = stripIndents`
          ### 👋 Hey there! I can see you might be a bit confused - I'm here to help!

          **You're in a cross-server chat!** This channel is connected to **${hub.data.name}**, which means you're chatting with people from multiple Discord servers all at once! Pretty cool, right? ✨

          **🚀 Here's how it works:**
          - Messages you send here go to **all connected servers** in this hub
          - People from other servers can see and reply to your messages
          - It's like having one big conversation across multiple communities!

          **💝 Need more help?**
          - Type \`/help\` to see all available commands or try \`/tutorial\` for interactive guides
          - Join our friendly [support server](${Constants.Links.SupportInvite}}) if you have questions!

          **Welcome to the InterChat community!** 🎉 Feel free to introduce yourself - everyone loves meeting new friends!
        `;

    // Send helpful response
    try {
      await message.reply({
        content: messageContent,
        allowedMentions: { repliedUser: false },
      });
    }
    catch {
      // If reply fails, try sending a regular message
      try {
        await message.channel.send({
          content: messageContent,
          allowedMentions: { parse: [] },
        });
      }
      catch (sendError) {
        // Log error but don't throw to avoid disrupting message flow
        Logger.error('Failed to send confused user help message:', sendError);
      }
    }
  }

  /**
   * Updates leaderboards and metrics after a message is broadcast
   * @param message The Discord message
   * @param hub The hub manager instance
   */
  private updateStatsAfterBroadcast(
    message: Message<true>,
    hub: { name: string; id: string; connections: { count: number } },
  ): void {
    updateLeaderboards('user', message.author.id);
    updateLeaderboards('server', message.guildId);
    message.client.shardMetrics.incrementMessage(hub.name);

    // Track achievements
    const achievementService = new AchievementService();
    achievementService
      .processEvent(
        'message',
        {
          userId: message.author.id,
          hubId: hub.id,
          serverId: message.guildId,
          broadcastCount: hub.connections.count,
        },
        message.client,
        message.channelId,
      )
      .catch(handleError);
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
  async processCallMessage(message: Message<true>): Promise<void> {
    try {
      // Get active call data and user data in parallel

      const distributedCallingLibrary = this.getDistributedCallingLibrary();
      if (!distributedCallingLibrary) {
        Logger.debug('DistributedCallingLibrary not available for call message processing');
        return;
      }

      const [activeCall, userData] = await Promise.all([
        distributedCallingLibrary.getActiveCall(message.channelId),
        ensureUserExists(message.author.id, message.author.username, message.author.avatarURL()),
      ]);

      // Validate call and user data
      if (!activeCall || !userData) {
        Logger.debug(
          `Call message processing failed: ${!activeCall ? 'No active call' : 'No user data'}`,
        );
        return;
      }

      // Track this user as a participant in the call
      await distributedCallingLibrary.addParticipant(message.channelId, message.author.id);

      // Find the other participant to send the message to
      const otherParticipant = activeCall.participants.find(
        (p) => p.channelId !== message.channelId,
      );

      if (!otherParticipant) {
        Logger.debug('No other participant found in call');
        return;
      }

      const attachmentURL = message.attachments.first()?.url;

      // Run call-specific checks (spam, URLs, GIFs, NSFW, media limits, etc.)
      const checksPassed = await runCallChecks(message, {
        userData,
        attachmentURL,
      });

      if (!checksPassed) {
        return;
      }

      // Check content filter
      const contentFilterResult = await ContentFilterManager.getInstance().checkMessage(message);

      if (contentFilterResult.blocked) {
        // Log the blocked message
        await logBlockedMessage(message);

        // Get a random humorous response
        const humorousResponse = getRandomBlockedMessageResponse();

        // Send notification to the other participant with simple content
        await BroadcastService.sendMessage(otherParticipant.webhookUrl, {
          content: `**The user's message was blocked by our content filter.**\n${humorousResponse}`,
          username: 'InterChat Calls',
          avatarURL: message.client.user.displayAvatarURL(),
          allowedMentions: { parse: [] },
        });

        // Store the blocked message for moderation purposes
        await distributedCallingLibrary.updateCallMessage(
          message.channelId,
          message.author.id,
          message.author.username,
          `[BLOCKED] ${message.content}`,
          attachmentURL,
        );
        return;
      }

      // Check if this is a reply message and handle accordingly
      const referencedMessage = message.reference?.messageId
        ? await message.channel.messages.fetch(message.reference.messageId).catch(() => null)
        : null;

      if (referencedMessage) {
        // Process as a reply message with enhanced formatting
        await this.callReplyService.processCallReply(message, activeCall, referencedMessage);
      }
      else {
        // Send regular message with simple content

        // Include attachment URL in content if present
        const contentWithAttachment = attachmentURL
          ? `${message.content}\n${attachmentURL}`
          : message.content;

        await BroadcastService.sendMessage(otherParticipant.webhookUrl, {
          content: contentWithAttachment,
          username: message.author.username,
          avatarURL: message.author.displayAvatarURL(),
          allowedMentions: { parse: [] },
        });
      }

      // Update call participation after successful message send
      await distributedCallingLibrary.updateCallMessage(
        message.channelId,
        message.author.id,
        message.author.username,
        message.content,
        attachmentURL,
      );

      // Update user info if changed (after successful processing)
      updateUserInfoIfChanged(
        message.author.id,
        message.author.username,
        message.author.avatarURL(),
      ).catch(() => null); // Don't let this fail the whole process
    }
    catch (error) {
      handleError(error, { comment: 'Failed to process call message' });
    }
  }
}
