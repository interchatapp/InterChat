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

import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import type { Infraction } from '#src/generated/prisma/client/client.js';
import { PaginationManager } from '#src/utils/ui/PaginationManager.js';
import { HubService } from '#src/services/HubService.js';
import Constants from '#src/utils/Constants.js';
import { runHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { showModeratedHubsAutocomplete } from '#src/utils/moderation/blacklistUtils.js';
import db from '#utils/Db.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import { fetchUserLocale, toTitleCase } from '#utils/Utils.js';
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  type User,
  time,
} from 'discord.js';

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
    if (!hub || !(await runHubRoleChecksAndReply(hub, ctx, { checkIfMod: true }))) return;

    const list = await db.infraction.findMany({
      where: { hubId: hub.id, type: 'BLACKLIST', status: 'ACTIVE' },
      orderBy: { expiresAt: 'desc' },
      include: { user: { select: { name: true } } },
    });

    if (list.length === 0) {
      await ctx.editReply({
        content: `No blacklisted ${ctx.options.getString('type', true)}s found in hub **${hubName}**.`,
      });
      return;
    }

    const type = ctx.options.getString('type', true) as 'user' | 'server';

    // Prepare data with moderators
    const enrichedList = await Promise.all(
      list.map(async (data) => {
        const moderator = data.moderatorId
          ? await ctx.client.users.fetch(data.moderatorId).catch(() => null)
          : null;
        return { data, moderator };
      }),
    );

    // Use PaginationManager
    const paginationManager = new PaginationManager({
      client: ctx.client,
      identifier: `blacklist-${hub.id}-${type}`,
      items: enrichedList,
      itemsPerPage: 5,
      contentGenerator: (pageIndex, itemsOnPage) =>
        this.buildBlacklistContainer(itemsOnPage, type, locale, ctx),
    });

    await paginationManager.start(ctx);
  }

  private buildBlacklistContainer(
    items: Array<{
      data: Infraction & { user: { name: string | null } | null };
      moderator: User | null;
    }>,
    type: 'server' | 'user',
    locale: supportedLocaleCodes,
    ctx: Context,
  ) {
    const container = new ContainerBuilder();

    // Add title
    const titleText = new TextDisplayBuilder().setContent(`# Blacklisted ${toTitleCase(type)}s`);
    container.addTextDisplayComponents(titleText);

    // Add each blacklist entry as a section with an edit button
    for (const { data, moderator } of items) {
      const name = isServerType(data)
        ? (data.serverName ?? 'Unknown Server')
        : (data.user?.name ?? 'Unknown User');

      const targetId = (data.userId ?? data.serverId) as string;

      const content = t(`blacklist.list.${type}`, locale, {
        id: targetId,
        moderator: moderator ? `@${moderator.username} (${moderator.id})` : 'Unknown',
        reason: `${data?.reason}`,
        expires: !data?.expiresAt
          ? 'Never'
          : `${time(Math.round(data?.expiresAt.getTime() / 1000), 'R')}`,
      });

      const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${name}\n${content}`))
        .setButtonAccessory(
          new ButtonBuilder()
            .setLabel('Edit')
            .setStyle(ButtonStyle.Link)
            .setURL(`${Constants.Links.Website}/dashboard/moderation/blacklist/extend/${data.id}`)
            .setEmoji(ctx.getEmoji('edit_icon')),
        );

      container.addSectionComponents(section);
    }

    return container;
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await showModeratedHubsAutocomplete(interaction, this.hubService);
  }
}
