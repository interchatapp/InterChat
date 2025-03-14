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
import { getConnectionHubId } from '#src/utils/ConnectedListUtils.js';
import db from '#src/utils/Db.js';
import { updateLeaderboards } from '#src/utils/Leaderboard.js';
import { runChecks } from '#src/utils/network/runChecks.js';
import { fetchUserData } from '#src/utils/Utils.js';
import type { Message } from 'discord.js';
import { BroadcastService } from './BroadcastService.js';
import { getRedis } from '#src/utils/Redis.js';
import { RedisKeys } from '#src/utils/Constants.js';

type messageProcessingResult = { handled: false; hub: null } | { handled: true; hub: HubManager };

export class MessageProcessor {
  private readonly broadcastService = new BroadcastService();

  static async getHubAndConnections(channelId: string, userId: string) {
    const connectionHubId = await getConnectionHubId(channelId);
    if (!connectionHubId) return null;

    const hub = await db.hub.findFirst({
      where: { id: connectionHubId },
      include: {
        connections: { where: { connected: true } },
        rulesAcceptances: { where: { userId }, take: 1 },
      },
    });
    if (!hub) return null;

    const connectionIndex = hub.connections.findIndex((c) => c.channelId === channelId);
    const connection = hub.connections.splice(connectionIndex, 1)[0];
    if (!connection) return null;

    return {
      hub: new HubManager(hub),
      hubRaw: hub,
      connection: new ConnectionManager(connection),
      hubConnections: hub.connections.map((c) => new ConnectionManager(c)),
    };
  }

  async processHubMessage(message: Message<true>): Promise<messageProcessingResult> {
    const hubAndConnections = await MessageProcessor.getHubAndConnections(
      message.channelId,
      message.author.id,
    );

    if (!hubAndConnections) return { handled: false, hub: null };
    const { hub, hubRaw, hubConnections, connection } = hubAndConnections;

    const userData = await fetchUserData(message.author.id);

    // First check if user accepted bot rules
    if (!userData?.acceptedRules) {
      await showRulesScreening(message, userData);
      return { handled: false, hub: null };
    }

    // Add a cooldown check for hub rules
    const rulesShownKey = `${RedisKeys.RulesShown}:${message.author.id}:${hub.id}`;
    const redis = getRedis();
    const rulesShown = await redis.get(rulesShownKey);

    if (!hubRaw.rulesAcceptances.length && hub.getRules().length > 0) {
      if (rulesShown) return { handled: false, hub: null };

      // Set a cooldown of 5 minutes to prevent spam
      await redis.set(rulesShownKey, '1', 'EX', 300);
      await showRulesScreening(message, userData, hub);
      return { handled: false, hub: null };
    }

    const attachmentURL = await this.broadcastService.resolveAttachmentURL(message);

    if (
      !(await runChecks(message, hub, {
        userData,
        settings: hub.settings,
        attachmentURL,
        totalHubConnections: hubConnections.length + 1,
      }))
    ) {
      return { handled: false, hub: null };
    }

    message.channel.sendTyping().catch(() => null);

    await this.broadcastService.broadcastMessage(
      message,
      hub,
      hubConnections,
      connection,
      attachmentURL,
    );

    updateLeaderboards('user', message.author.id);
    updateLeaderboards('server', message.guildId);
    message.client.shardMetrics.incrementMessage(hub.data.name);

    return { handled: true, hub };
  }
}
