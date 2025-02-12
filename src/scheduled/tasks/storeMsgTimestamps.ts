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

import getRedis from '#src/utils/Redis.js';
import { updateConnection } from '#utils/ConnectedListUtils.js';
import { RedisKeys } from '#utils/Constants.js';
import Logger from '#utils/Logger.js';

export default async () => {
  const exists = await getRedis().exists(`${RedisKeys.msgTimestamp}`);
  if (!exists) return;
  const timestampsObj = await getRedis().hgetall(`${RedisKeys.msgTimestamp}`);

  for (const [channelId, timestamp] of Object.entries(timestampsObj)) {
    await updateConnection({ channelId }, { lastActive: new Date(Number.parseInt(timestamp)) });
    Logger.debug(`Stored message timestamps for channel ${channelId} from cache to db.`);
    await getRedis().hdel(`${RedisKeys.msgTimestamp}`, channelId);
  }
};
