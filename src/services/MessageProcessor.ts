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

import { showRulesScreening } from '#src/interactions/RulesScreening.js';
import ConnectionManager from '#src/managers/ConnectionManager.js';
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
import type { Hub, User } from '#src/generated/prisma/client/client.js';

/**
 * Result of processing a message in a hub channel
 */
type MessageProcessingResult = { handled: false; hub: null } | { handled: true; hub: HubManager };

/**
 * Data structure returned when retrieving hub and connections
 */
interface HubConnectionData {
  hub: HubManager;
  hubRaw: Hub & { rulesAcceptances: { userId: string }[]; connections: { channelId: string }[] };
  connection: ConnectionManager;
  hubConnections: ConnectionManager[];
}

/**
 * Processes messages for both hub channels and call channels
 */
export class MessageProcessor {
  private readonly broadcastService: BroadcastService;
  private readonly callService: CallService;

  /**
   * Creates a new MessageProcessor instance
   * @param client Discord client instance
   */
  constructor(client: Client) {
    this.broadcastService = new BroadcastService();
    this.callService = new CallService(client);
  }

  /**
   * Retrieves hub and connection data for a given channel and user
   * @param channelId The channel ID to get hub data for
   * @param userId The user ID to check rules acceptance for
   * @returns Hub and connection data or null if not found
   */
  static async getHubAndConnections(
    channelId: string,
    userId: string,
  ): Promise<HubConnectionData | null> {
    // Get the hub ID associated with this channel
    const connection = await db.connection.findFirst({
      where: { channelId, connected: true },
      include: {
        hub: {
          include: {
            connections: { where: { connected: true, channelId: { not: channelId } } },
            rulesAcceptances: { where: { userId }, take: 1 },
          },
        },
      },
    });
    if (!connection) return null;

    // Fetch the hub with its connections and rule acceptances
    const hub = connection.hub;
    if (!hub) return null;

    // Return the hub and connection data
    return {
      hub: new HubManager(hub),
      hubRaw: hub,
      connection: new ConnectionManager(connection),
      hubConnections: hub.connections.map((c) => new ConnectionManager(c)),
    };
  }

  /**
   * Processes a message sent in a hub channel
   * @param message The Discord message to process
   * @returns Result indicating if the message was handled and the associated hub
   */
  async processHubMessage(message: Message<true>): Promise<MessageProcessingResult> {
    try {
      // Get hub and connection data for this channel
      const hubAndConnections = await MessageProcessor.getHubAndConnections(
        message.channelId,
        message.author.id,
      );

      if (!hubAndConnections) return { handled: false, hub: null };
      const { hub, hubRaw, hubConnections, connection } = hubAndConnections;

      // Ensure webhook URL is set (if connected through dashboard it might not be)
      if (connection.data.webhookURL.length < 1) {
        await this.setConnectionWebhookURL(connection, message.channel);
      }

      // Get user data for rules checking and other operations
      const userData = await fetchUserData(message.author.id);

      // Check if user has accepted the bot's global rules
      if (!(await this.checkBotRulesAcceptance(message, userData))) {
        return { handled: false, hub: null };
      }

      // Check if user has accepted the hub's specific rules
      if (!(await this.checkHubRulesAcceptance(message, userData, hub, hubRaw))) {
        return { handled: false, hub: null };
      }

      // Resolve any attachments in the message
      const attachmentURL = await this.broadcastService.resolveAttachmentURL(message);

      // Run all message checks (ban, blacklist, NSFW, anti-swear, etc.)
      if (
        !(await this.runMessageChecks(message, hub, userData, attachmentURL, hubConnections.length))
      ) {
        return { handled: false, hub: null };
      }

      // Indicate typing in the channel to show the message is being processed
      message.channel.sendTyping().catch(() => null);

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
      this.updateStatsAfterBroadcast(message, hub);

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
   * Checks if a user has accepted the hub's specific rules
   * @param message The Discord message
   * @param userData The user's data from the database
   * @param hub The hub manager instance
   * @param hubRaw The raw hub data from the database
   * @returns Whether the user has accepted the hub rules or if no rules exist
   */
  private async checkHubRulesAcceptance(
    message: Message<true>,
    userData: User | null,
    hub: HubManager,
    hubRaw: Hub & { rulesAcceptances: { userId: string }[] },
  ): Promise<boolean> {
    // If the hub has no rules or the user has already accepted them, return true
    if (hubRaw.rulesAcceptances.length || hub.getRules().length === 0) {
      return true;
    }

    // Check if we've recently shown the rules to this user (cooldown)
    const rulesShownKey = `${RedisKeys.RulesShown}:${message.author.id}:${hub.id}`;
    const redis = getRedis();
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
   * Updates statistics and metrics after a successful message broadcast
   * @param message The Discord message
   * @param hub The hub manager instance
   */
  private updateStatsAfterBroadcast(message: Message<true>, hub: HubManager): void {
    updateLeaderboards('user', message.author.id);
    updateLeaderboards('server', message.guildId);
    message.client.shardMetrics.incrementMessage(hub.data.name);
  }

  /**
   * Sets the webhook URL for a connection if it doesn't have one
   * @param connection The connection manager instance
   * @param channel The Discord channel
   * @returns Result of the operation or void if successful
   */
  private async setConnectionWebhookURL(
    connection: ConnectionManager,
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
      // Get active call data and user data
      const activeCall = await this.callService.getActiveCallData(message.channelId);
      const userData = await fetchUserData(message.author.id);

      // Validate call and user data
      if (!activeCall || !userData) {
        return false;
      }

      // Check if user has accepted the bot's rules
      if (!userData.acceptedRules) {
        await showRulesScreening(message, userData);
        return false;
      }

      // Track this user as a participant in the call
      await this.callService.addParticipant(message.channelId, message.author.id);

      // Find the other participant to send the message to
      const otherParticipant = activeCall.participants.find(
        (p) => p.channelId !== message.channelId,
      );
      if (!otherParticipant) {
        Logger.debug('No other participant found in call');
        return false;
      }

      const attachmentURL = message.attachments.first()?.url;

      if (!userData) {
        Logger.debug('Cannot run call checks: userData is null');
        return false;
      }

      // Run call-specific checks (spam, URLs, GIFs, NSFW, etc.)
      const checksPassed = await runCallChecks(message, {
        userData,
        attachmentURL,
      });

      if (!checksPassed) {
        return false;
      }

      // Send the message to the other participant
      await BroadcastService.sendMessage(otherParticipant.webhookUrl, {
        content: message.content,
        username: message.author.username,
        avatarURL: message.author.displayAvatarURL(),
        allowedMentions: { parse: [] },
      });

      // Update call participation after successful message send
      await this.callService.updateCallParticipant(message.channelId, message.author.id);
      return true;
    }
    catch (error) {
      handleError(error, { comment: 'Failed to process call message' });
      return false;
    }
  }
}
