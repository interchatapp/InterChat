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

import { ActivityType, type Client } from 'discord.js';
import BaseEventListener from '#src/core/BaseEventListener.js';
import updateBlacklists from '#src/scheduled/tasks/updateBlacklists.js';
import Scheduler from '#src/services/SchedulerService.js';
import Logger from '#utils/Logger.js';

export default class Ready extends BaseEventListener<'ready'> {
  readonly name = 'ready';
  public execute(client: Client<true>) {
    Logger.info(`Logged in as ${client.user.tag}!`);

    client.application.emojis.fetch();

    if (client.cluster.id === 0) {
      Logger.debug(`Cluster ${client.cluster.id} is updating blacklists...`);
      updateBlacklists(client).then(() =>
        Logger.debug(`Cluster ${client.cluster.id} has finished updating blacklists!`),
      );

      Logger.debug(`Cluster ${client.cluster.id} is setting up recurring tasks...`);
      const scheduler = new Scheduler();
      scheduler.stopTask('deleteExpiredBlacklists');
      scheduler.addRecurringTask('deleteExpiredBlacklists', 30 * 1000, () =>
        updateBlacklists(client),
      );
      Logger.debug(`Cluster ${client.cluster.id} has set up recurring tasks!`);
    }

    client.user.setActivity({
      name: `/setup | Cluster ${client.cluster.id}`,
      type: ActivityType.Watching,
    });
  }
}
