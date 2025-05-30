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

import type { Infraction } from '#src/generated/prisma/client/client.js';
import { buildAppealSubmitButton } from '#src/interactions/BlacklistAppeal.js';
import { HubService } from '#src/services/HubService.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { escapeRegexChars } from '#src/utils/Utils.js';
import { getHubConnections } from '#utils/ConnectedListUtils.js';
import Constants from '#utils/Constants.js';
import db from '#utils/Db.js';
import Logger from '#utils/Logger.js';
import {
  type APIActionRowComponent,
  type APIButtonComponent,
  type AutocompleteInteraction,
  type Client,
  EmbedBuilder,
  type Snowflake,
  type User,
} from 'discord.js';

export const isBlacklisted = (infraction: Infraction | null): infraction is Infraction =>
  Boolean(
    infraction?.type === 'BLACKLIST' &&
      infraction.status === 'ACTIVE' &&
      (!infraction.expiresAt || infraction.expiresAt > new Date()),
  );

export const buildBlacklistNotifEmbed = (
  type: 'user' | 'server',
  client: Client,
  opts: {
    hubName: string;
    expiresAt: Date | null;
    reason?: string;
  },
) => {
  const expireString = opts.expiresAt
    ? `<t:${Math.round(opts.expiresAt.getTime() / 1000)}:R>`
    : 'Never';

  const targetStr = type === 'user' ? 'You have' : 'This server has';

  return new EmbedBuilder()
    .setTitle(`${getEmoji('hammer_icon', client)} You have been blacklisted!`)
    .setDescription(`${targetStr} been blacklisted from talking in hub **${opts.hubName}**.`)
    .setColor(Constants.Colors.primary)
    .setFields(
      {
        name: 'Reason',
        value: opts.reason ?? 'No reason provided.',
        inline: true,
      },
      { name: 'Expires', value: expireString, inline: true },
    );
};

interface BlacklistOpts {
  target: User | { id: Snowflake };
  hubId: string;
  expiresAt: Date | null;
  reason?: string;
}

/** * Notify a user or server that they have been blacklisted. */
export const sendBlacklistNotif = async (
  type: 'user' | 'server',
  client: Client,
  opts: BlacklistOpts,
) => {
  try {
    const hub = await new HubService().fetchHub(opts.hubId);
    const embed = buildBlacklistNotifEmbed(type, client, {
      hubName: `${hub?.data.name}`,
      expiresAt: opts.expiresAt,
      reason: opts.reason,
    });

    let components: APIActionRowComponent<APIButtonComponent>[] = [];
    if (!opts.expiresAt || opts.expiresAt.getTime() >= Date.now() + 60 * 60 * 24 * 1000) {
      components = [buildAppealSubmitButton(type, opts.hubId).toJSON()];
    }

    if (type === 'user') {
      await (opts.target as User).send({ embeds: [embed], components }).catch(() => null);
    }
    else {
      const serverInHub =
        (await getHubConnections(opts.hubId))?.find((con) => con.serverId === opts.target.id) ??
        (await db.connection.findFirst({
          where: { serverId: opts.target.id, hubId: opts.hubId },
        }));

      if (!serverInHub) return;
      await client.cluster.broadcastEval(
        async (_client, ctx) => {
          const channel = await _client.channels.fetch(ctx.channelId).catch(() => null);
          if (!channel?.isSendable()) return;

          await channel.send({ embeds: [ctx.embed], components: ctx.components }).catch(() => null);
        },
        {
          context: {
            components,
            channelId: serverInHub.channelId,
            embed: embed.toJSON(),
          },
        },
      );
    }
  }
  catch (error) {
    Logger.error(error);
  }
};

export const showModeratedHubsAutocomplete = async (
  interaction: AutocompleteInteraction,
  hubService: HubService,
) => {
  const focusedValue = escapeRegexChars(interaction.options.getFocused());
  const hubs = await hubService.fetchModeratedHubs(interaction.user.id);
  await interaction.respond(
    hubs
      .filter((hub) => hub.data.name.toLowerCase().includes(focusedValue.toLowerCase()))
      .map((hub) => ({ name: hub.data.name, value: hub.data.name })),
  );
};
