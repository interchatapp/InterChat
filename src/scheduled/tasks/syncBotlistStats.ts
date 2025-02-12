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

import { handleError } from '#src/utils/Utils.js';
import Logger from '#utils/Logger.js';

const logPostError = (error: unknown) => {
  handleError(error, { comment: 'Failed to update top.gg stats' });
};

const logPostSuccess = (data: TopggStats) => {
  Logger.info(
    `[TopGGPostStats]: Updated top.gg stats with ${data.serverCount} guilds and ${data.shardCount} shards`,
  );
};

type TopggStats = {
  serverCount: number;
  shardCount: number;
};

export default async ({ serverCount, shardCount }: TopggStats) => {
  if (process.env.CLIENT_ID !== '769921109209907241') {
    Logger.warn(
      '[TopGGPostStats]: CLIENT_ID environment variable does not match InterChat\'s actual ID.',
    );
    return;
  }

  await fetch('https://top.gg/api/v1/bots/769921109209907241/stats', {
    method: 'POST',
    body: JSON.stringify({ serverCount, shardCount }),
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.TOPGG_API_KEY as string,
    },
  })
    .then(async (res) => {
      const data = (await res.json()) as TopggStats;

      if (res.status !== 200) {
        logPostError(data);
        return;
      }

      logPostSuccess(data);
    })
    .catch(logPostError);
};
