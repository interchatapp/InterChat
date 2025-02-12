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
import { HubService } from '#src/services/HubService.js';
import { getConnectionHubId } from '#src/utils/ConnectedListUtils.js';
import { runChecks } from '#src/utils/network/runChecks.js';
import { fetchUserData } from '#src/utils/Utils.js';
import type { Message } from 'discord.js';
import { BroadcastService } from './BroadcastService.js';

export class MessageProcessor {
  private readonly broadcastService = new BroadcastService();
  private readonly hubService = new HubService();

  static async getHubAndConnections(channelId: string, hubService: HubService) {
    const connectionHubId = await getConnectionHubId(channelId);
    if (!connectionHubId) return null;

    const hub = await hubService.fetchHub(connectionHubId);
    if (!hub) return null;

    const allConnections = await hub.connections.fetch();
    const hubConnections = allConnections.filter(
      (c) => c.data.connected && c.data.channelId !== channelId,
    );
    const connection = allConnections.find((c) => c.data.channelId === channelId);
    if (!connection?.data.connected) return null;

    return { hub, hubConnections, connection };
  }

  async processHubMessage(message: Message<true>) {
    const hubData = await MessageProcessor.getHubAndConnections(message.channelId, this.hubService);
    if (!hubData) return;

    const { hub, hubConnections, connection } = hubData;

    const userData = await fetchUserData(message.author.id);
    if (!userData?.acceptedRules) {
      await showRulesScreening(message, userData);
      return;
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
      return;
    }

    message.channel.sendTyping().catch(() => null);

    await this.broadcastService.broadcastMessage(
      message,
      hub,
      hubConnections,
      connection,
      attachmentURL,
    );

    await message.client.userLevels.handleMessage(message);
  }
}
