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

import db from '#src/utils/Db.js';
import getRedis from '#src/utils/Redis.js';
import { getConnectionHubId, updateConnection } from '#utils/ConnectedListUtils.js';
import { RedisKeys } from '#utils/Constants.js';
import Logger from '#utils/Logger.js';

export default async () => {
  const exists = await getRedis().exists(`${RedisKeys.msgTimestamp}`);
  if (!exists) return;

  const timestampsObj = await getRedis().hgetall(`${RedisKeys.msgTimestamp}`);
  const hubTimestamps = new Map<string, number>();

  for (const [channelId, timestamp] of Object.entries(timestampsObj)) {
    const parsedTimestamp = Number.parseInt(timestamp);

    // Update connection's lastActive
    await updateConnection({ channelId }, { lastActive: new Date(parsedTimestamp) });
    Logger.debug(`Stored message timestamps for channel ${channelId} from cache to db.`);

    // Get hubId for this connection
    const hubId = await getConnectionHubId(channelId);
    if (hubId) {
      const currentTimestamp = hubTimestamps.get(hubId);
      // Only update if this timestamp is higher than what we already have
      if (!currentTimestamp || parsedTimestamp > currentTimestamp) {
        hubTimestamps.set(hubId, parsedTimestamp);
      }
    }

    await getRedis().hdel(`${RedisKeys.msgTimestamp}`, channelId);
  }

  // Update hubs with their latest activity timestamps
  for (const [hubId, timestamp] of hubTimestamps) {
    await db.hub.update({
      where: { id: hubId },
      data: { lastActive: new Date(timestamp) },
    });
    Logger.debug(`Updated lastActive for hub ${hubId} to ${new Date(timestamp)}`);
  }
};
