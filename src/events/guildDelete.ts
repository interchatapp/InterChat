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

import type { Guild } from 'discord.js';
import BaseEventListener from '#src/core/BaseEventListener.js';
import { deleteConnections } from '#utils/ConnectedListUtils.js';
import { logGuildLeave } from '#utils/GuildUtils.js';
import Logger from '#utils/Logger.js';
import { logGuildLeaveToHub } from '#utils/hub/logger/JoinLeave.js';
import db from '#src/utils/Db.js';

export default class Ready extends BaseEventListener<'guildDelete'> {
  readonly name = 'guildDelete';
  public async execute(guild: Guild) {
    if (!guild.available) return;

    Logger.info(`Left ${guild.name} (${guild.id})`);

    const deletedConnections = await deleteConnections({ serverId: guild.id });

    deletedConnections.forEach(async (connection) => {
      if (connection) await logGuildLeaveToHub(connection.hubId, guild);
    });


    const infraction = await db.infraction.findFirst({ where: { serverId: guild.id } });
    // only delete guild if it doesn't have any infractions
    if (!infraction) await db.serverData.deleteMany({ where: { id: guild.id } });

    logGuildLeave(guild);
  }
}
