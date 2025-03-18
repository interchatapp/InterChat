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
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  EmbedBuilder,
  type User,
  time,
} from 'discord.js';
import { Pagination } from '#src/modules/Pagination.js';
import Constants from '#utils/Constants.js';
import db from '#utils/Db.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import { fetchUserLocale, toTitleCase } from '#utils/Utils.js';
import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import { HubService } from '#src/services/HubService.js';
import { executeHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { showModeratedHubsAutocomplete } from '#src/utils/moderation/blacklistUtils.js';

// Type guard
const isServerType = (list: Infraction) => list.serverId && list.serverName;

export default class BlacklistListSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'list',
      description: 'List all blacklisted users/servers in your hub.',
      types: { slash: true, prefix: true },
      options: [
        {
          name: 'hub',
          description: 'The hub to list blacklisted users/servers from.',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true,
        },
        {
          name: 'type',
          description: 'The type of blacklist to list.',
          type: ApplicationCommandOptionType.String,
          choices: [
            { name: 'User', value: 'user' },
            { name: 'Server', value: 'server' },
          ],
          required: true,
        },
      ],
    });
  }

  async execute(ctx: Context) {
    await ctx.deferReply();

    const hubName = ctx.options.getString('hub', true);
    const hub = (await this.hubService.findHubsByName(hubName)).at(0);

    const locale = await fetchUserLocale(ctx.user.id);
    if (
      !hub ||
			!(await executeHubRoleChecksAndReply(hub, ctx, { checkIfMod: true }))
    ) return;

    const list = await db.infraction.findMany({
      where: { hubId: hub.id, type: 'BLACKLIST', status: 'ACTIVE' },
      orderBy: { expiresAt: 'desc' },
      include: { user: { select: { name: true } } },
    });

    const options = { LIMIT: 5, iconUrl: hub.data.iconUrl };

    const fields = [];
    let counter = 0;
    const type = isServerType(list[0]) ? 'server' : 'user';

    const paginator = new Pagination(ctx.client);
    for (const data of list) {
      const moderator = data.moderatorId
        ? await ctx.client.users.fetch(data.moderatorId).catch(() => null)
        : null;

      fields.push(this.createFieldData(data, type, { moderator, locale }));

      counter++;
      if (counter >= options.LIMIT || fields.length === list.length) {
        paginator.addPage({
          embeds: [
            new EmbedBuilder()
              .setFields(fields)
              .setColor(Constants.Colors.invisible)
              .setAuthor({
                name: `Blacklisted ${toTitleCase(type)}s:`,
                iconURL: options.iconUrl,
              }),
          ],
        });

        counter = 0;
        fields.length = 0; // Clear fields array
      }
    }

    await paginator.run(ctx);
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await showModeratedHubsAutocomplete(interaction, this.hubService);
  }

  private createFieldData(
    data: Infraction & { user: { name: string | null } | null },
    type: 'user' | 'server',
    {
      moderator,
      locale,
    }: {
      moderator: User | null;
      locale: supportedLocaleCodes;
    },
  ) {
    const name = isServerType(data)
      ? (data.serverName ?? 'Unknown Server.')
      : (data.user?.name ?? 'Unknown User.');

    return {
      name,
      value: t(`blacklist.list.${type}`, locale, {
        id: (data.userId ?? data.serverId) as string,
        moderator: moderator
          ? `@${moderator.username} (${moderator.id})`
          : 'Unknown',
        reason: `${data?.reason}`,
        expires: !data?.expiresAt
          ? 'Never.'
          : `${time(Math.round(data?.expiresAt.getTime() / 1000), 'R')}`,
      }),
    };
  }
}
