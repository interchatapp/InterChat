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

import type { Infraction } from '@prisma/client';
import { stripIndents } from 'common-tags';
import { type Client, EmbedBuilder, type User, time } from 'discord.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Constants from '#utils/Constants.js';
import { msToReadable, toTitleCase } from '#utils/Utils.js';

const createFieldData = (data: Infraction, { moderator }: { moderator: User | null }) => {
  let expiresAt = 'Never';
  if (data.expiresAt) {
    expiresAt =
      data.expiresAt > new Date()
        ? msToReadable(data.expiresAt.getTime() - Date.now())
        : `Expired at ${data.expiresAt.toLocaleDateString()}`;
  }

  return {
    name: `${data.id} (${time(data.createdAt, 'R')})`,
    value: stripIndents`
    > \`\`\`yaml
    > Type: ${data.type}
    > Status: ${data.status}
    > Reason: ${data.reason}
    > Moderator: ${moderator ? moderator.tag : 'Unknown.'}
    > Expires: ${expiresAt}
    > \`\`\`
    `,
  };
};

export const buildInfractionListEmbeds = async (
  client: Client,
  targetName: string,
  infractions: Infraction[],
  type: 'server' | 'user',
  iconURL: string,
) => {
  let fields: { name: string; value: string }[] = [];
  const options = { LIMIT: 5 };
  let counter = 0;

  const firstInfraction = infractions.at(0);
  const targetId = firstInfraction?.serverId ?? firstInfraction?.userId;

  const pages = [];
  for (const infraction of infractions) {
    const moderator = infraction.moderatorId
      ? await client.users.fetch(infraction.moderatorId).catch(() => null)
      : null;

    fields.push(createFieldData(infraction, { moderator }));

    counter++;
    if (counter >= options.LIMIT || fields.length === infractions.length) {
      pages.push({
        embeds: [
          new EmbedBuilder()
            .setTitle(`ID: ${targetId} | ${infractions.length} Total Infractions`)
            .setDescription(
              `${getEmoji('exclamation', client)} **Currently Blacklisted:** ${infractions.some((i) => i.type === 'BLACKLIST' && i.status === 'ACTIVE')}`,
            )
            .setFields(fields)
            .setColor(Constants.Colors.invisible)
            .setAuthor({
              name: `${toTitleCase(type)} ${targetName} Infractions`,
              iconURL,
            }),
        ],
      });

      counter = 0;
      fields = []; // Clear fields array
    }
  }

  return pages;
};
