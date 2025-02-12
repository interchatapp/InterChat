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

import type { Client } from 'discord.js';
import BlacklistManager from '#src/managers/BlacklistManager.js';
import HubManager from '#src/managers/HubManager.js';
import db from '#utils/Db.js';
import { logServerUnblacklist, logUserUnblacklist } from '#utils/hub/logger/ModLogs.js';

export default async (client: Client) => {
  const allInfractions = await db.infraction.findMany({
    where: { status: 'ACTIVE', expiresAt: { not: null, lte: new Date() } },
    include: { hub: true },
  });

  allInfractions?.forEach(async (infrac) => {
    const type = infrac.userId ? 'user' : 'server';
    const targetId = infrac.userId ?? infrac.serverId!;

    const blacklistManager = new BlacklistManager(type, targetId);
    await blacklistManager.removeBlacklist(infrac.hubId);

    if (client.user) {
      const opts = {
        id: targetId,
        mod: client.user,
        reason: 'Blacklist duration expired.',
      };
      if (type === 'user') {
        await logUserUnblacklist(client, new HubManager(infrac.hub), opts);
      }
      else if (type === 'server') {
        await logServerUnblacklist(client, new HubManager(infrac.hub), opts);
      }
    }
  });
};
