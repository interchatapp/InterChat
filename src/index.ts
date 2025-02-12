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

import '#src/instrument.js';
import { ClusterManager, HeartbeatManager, ReClusterManager } from 'discord-hybrid-sharding';
import startTasks from '#src/scheduled/startTasks.js';
import Logger from '#utils/Logger.js';
import 'dotenv/config';

const shardsPerClusters = 6;
const clusterManager = new ClusterManager('build/client.js', {
  token: process.env.DISCORD_TOKEN,
  totalShards: 'auto',
  totalClusters: 'auto',
  shardsPerClusters,
});

clusterManager.extend(new HeartbeatManager({ interval: 10 * 1000, maxMissedHeartbeats: 2 }));
clusterManager.extend(new ReClusterManager());

clusterManager.on('clusterReady', (cluster) => {
  Logger.info(
    `Cluster ${cluster.id} is ready with shards ${cluster.shardList[0]}...${cluster.shardList.at(-1)}.`,
  );

  if (cluster.id === clusterManager.totalClusters - 1) {
    startTasks(clusterManager);
  }

  cluster.on('message', async (message) => {
    if (message === 'recluster') {
      Logger.info('Recluster requested, starting recluster...');
      const recluster = await clusterManager.recluster?.start({
        restartMode: 'rolling',
        totalShards: 'auto',
        shardsPerClusters,
      });

      if (recluster?.success) Logger.info('Recluster completed successfully.');
      else Logger.error('Failed to recluster!');
    }
  });
});

// spawn clusters and start the api that handles nsfw filter and votes
clusterManager.spawn({ timeout: -1 });
