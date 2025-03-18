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

import HubCommand, { hubOption } from '#src/commands/Main/hub/index.js';
import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import type HubManager from '#src/managers/HubManager.js';
import InfractionManager from '#src/managers/InfractionManager.js';
import { Pagination } from '#src/modules/Pagination.js';
import { HubService } from '#src/services/HubService.js';
import type { RemoveMethods } from '#src/types/Utils.js';
import { fetchUserLocale, msToReadable } from '#src/utils/Utils.js';
import Constants from '#utils/Constants.js';
import db from '#utils/Db.js';
import { t } from '#utils/Locale.js';
import { buildInfractionListEmbeds } from '#utils/moderation/infractionUtils.js';
import type { Infraction, User } from '@prisma/client';
import { stripIndents } from 'common-tags';
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  type BaseMessageOptions,
  type Client,
  Collection,
  EmbedBuilder,
  type Guild,
  User as DiscordUser,
  time,
} from 'discord.js';

type InfractionType = 'server' | 'user';
type GroupedInfraction = Infraction & { user: User | null; count: number };

interface TargetInfo {
  name: string;
  iconURL: string;
}

export default class HubInfractionsSubcommand extends BaseCommand {
  constructor() {
    super({
      name: 'infractions',
      description: '🚩 View infractions for a user or server in a hub.',
      types: { slash: true, prefix: true },
      options: [
        hubOption,
        {
          name: 'type',
          description: 'The type of blacklist to view.',
          type: ApplicationCommandOptionType.String,
          required: true,
          choices: [
            { name: 'Server', value: 'server' },
            { name: 'User', value: 'user' },
          ],
        },
        {
          name: 'target',
          description: 'The userId or serverId to view infractions for.',
          type: ApplicationCommandOptionType.String,
          required: false,
        },
      ],
    });
  }
  private readonly hubService = new HubService();
  private static readonly INFRACTIONS_PER_PAGE = 5;

  async execute(ctx: Context) {
    await ctx.deferReply();

    const hub = await this.validateAndGetHub(ctx);
    if (!hub) return;

    const type = ctx.options.getString('type', true) as InfractionType;
    const targetId = ctx.options.getString('target');

    if (!targetId) {
      await this.showAllInfractions(ctx, hub, type);
      return;
    }

    await this.showTargetInfractions(ctx, hub, type, targetId);
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused(true);
    let choices: { name: string; value: string }[] = [];
    if (focused.name === 'hub') {
      choices = (
        await HubCommand.getModeratedHubs(
          focused.value,
          interaction.user.id,
          this.hubService,
        )
      ).map((hub) => ({ name: hub.data.name, value: hub.data.name }));
    }

    await interaction.respond(choices);
  }

  private async validateAndGetHub(ctx: Context): Promise<HubManager | null> {
    const hubName = ctx.options.getString('hub', true);
    const hub = (await this.hubService.fetchModeratedHubs(ctx.user.id)).find(
      (h) => h.data.name === hubName,
    );

    if (!hub) {
      const locale = await fetchUserLocale(ctx.user.id);
      await ctx.replyEmbed(
        t('hub.notFound_mod', locale, { emoji: ctx.getEmoji('x_icon') }),
      );
      return null;
    }

    return hub;
  }

  private async showTargetInfractions(
    ctx: Context,
    hub: HubManager,
    type: InfractionType,
    targetId: string,
  ) {
    const targetInfo = await this.getTargetInfo(
      ctx.client,
      type,
      targetId,
      hub.data.iconUrl,
    );
    const infractionManager = new InfractionManager(type, targetId);
    const infractions = await infractionManager.getHubInfractions(hub.id);

    // Update target name if it's a server infraction
    const finalTargetName =
			infractionManager.targetType === 'user'
			  ? targetInfo.name
			  : (infractions.at(0)?.serverName ?? 'Unknown Server');

    const embeds = await buildInfractionListEmbeds(
      ctx.client,
      finalTargetName,
      infractions,
      type,
      targetInfo.iconURL,
    );

    await this.displayPagination(ctx, embeds);
  }

  private async getTargetInfo(
    client: Client,
    type: InfractionType,
    targetId: string,
    defaultIconURL: string,
  ): Promise<TargetInfo> {
    if (type === 'user') {
      const user = await client.users.fetch(targetId).catch(() => null);
      return {
        name: user?.username ?? 'Unknown User',
        iconURL: user?.displayAvatarURL() ?? defaultIconURL,
      };
    }
    return {
      name: 'Unknown',
      iconURL: defaultIconURL,
    };
  }

  private async showAllInfractions(
    interaction: Context,
    hub: HubManager,
    type: InfractionType,
  ) {
    const Infractions = await this.getInfractions(hub.id);
    const embeds = await this.buildAllInfractionsEmbed(
      interaction.client,
      Infractions,
      type,
    );
    await this.displayPagination(interaction, embeds);
  }

  private async getInfractions(
    hubId: string,
  ): Promise<Collection<string, GroupedInfraction>> {
    // Fetch all infractions in a single query with included relations
    const infractions = await db.infraction.findMany({
      where: { hubId },
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });

    // Group infractions by target ID
    return infractions.reduce((grouped, infraction) => {
      const targetId = this.getTargetId(infraction);
      const existing = grouped.get(targetId);

      if (!existing) {
        grouped.set(targetId, { ...infraction, count: 1 });
      }
      else {
        // Only update count since we're already sorted by date
        grouped.set(targetId, { ...existing, count: existing.count + 1 });
      }

      return grouped;
    }, new Collection<string, GroupedInfraction>());
  }

  private async buildAllInfractionsEmbed(
    client: Client,
    Infractions: Collection<string, GroupedInfraction>,
    type: InfractionType,
  ) {
    const pages: BaseMessageOptions[] = [];
    const targetIds = [...Infractions.keys()];

    // Batch fetch all users/servers at once
    const [targets, moderators] = await Promise.all([
      this.batchFetchTargets(client, targetIds, type),
      this.batchFetchModerators(client, [
        ...new Set(Infractions.map((i) => i.moderatorId).filter(Boolean)),
      ]),
    ]);

    let currentFields: { name: string; value: string }[] = [];
    let counter = 0;

    for (const [targetId, infraction] of Infractions) {
      const target = targets.get(targetId);
      const moderator = moderators.get(infraction.moderatorId ?? '') ?? null;

      const field = {
        name: `${this.getTargetName(target, infraction)} (${targetId}) (${time(infraction.createdAt, 'R')})`,
        value: this.formatInfractionDetails(
          infraction,
          moderator,
          this.formatExpirationTime(infraction.expiresAt),
        ),
      };

      currentFields.push(field);
      counter++;

      if (
        this.shouldCreateNewPage(
          counter,
          currentFields.length,
          Infractions.size,
        )
      ) {
        pages.push(this.createPageEmbed(currentFields));
        currentFields = [];
        counter = 0;
      }
    }

    return pages;
  }

  private async batchFetchTargets(
    client: Client,
    targetIds: string[],
    type: InfractionType,
  ) {
    const targets = new Collection<string, DiscordUser | RemoveMethods<Guild>>();

    if (type === 'user') {
      const users = await Promise.all(
        targetIds.map((id) => client.users.fetch(id).catch(() => null)),
      );
      users.forEach((user, index) => {
        if (user) targets.set(targetIds[index], user);
      });
    }
    else {
      const guilds = await Promise.all(
        targetIds.map((id) => client.fetchGuild(id).catch(() => null)),
      );
      guilds.forEach((guild, index) => {
        if (guild) targets.set(targetIds[index], guild);
      });
    }

    return targets;
  }

  private async batchFetchModerators(client: Client, moderatorIds: string[]) {
    const moderators = new Collection<string, DiscordUser>();

    const users = await Promise.all(
      moderatorIds.map((id) => client.users.fetch(id).catch(() => null)),
    );

    users.forEach((user, index) => {
      if (user) moderators.set(moderatorIds[index], user);
    });

    return moderators;
  }

  private getTargetName(
    target: DiscordUser | RemoveMethods<Guild> | undefined,
    infraction: GroupedInfraction,
  ): string {
    if (!target) {
      return infraction.userId
        ? (infraction.user?.name ?? 'Unknown User')
        : (infraction.serverName ?? 'Unknown Server');
    }
    return target instanceof DiscordUser ? target.username : target.name;
  }

  private getTargetId(infraction: Infraction): string {
    return infraction.userId ?? infraction.serverId ?? '';
  }

  private async createInfractionField(
    client: Client,
    infraction: GroupedInfraction,
  ) {
    const moderator = await this.fetchModerator(client, infraction.moderatorId);
    const expiresAt = this.formatExpirationTime(infraction.expiresAt);
    const targetInfo = await this.getTargetFieldInfo(client, infraction);

    return {
      name: `${targetInfo.name} (${targetInfo.id}) (${time(infraction.createdAt, 'R')})`,
      value: this.formatInfractionDetails(infraction, moderator, expiresAt),
    };
  }

  private async fetchModerator(client: Client, moderatorId: string | null) {
    if (!moderatorId) return null;
    return await client.users.fetch(moderatorId).catch(() => null);
  }

  private formatExpirationTime(expiresAt: Date | null): string {
    if (!expiresAt) return 'Never';

    return expiresAt > new Date()
      ? msToReadable(expiresAt.getTime() - Date.now())
      : `Expired at ${expiresAt.toLocaleDateString()}`;
  }

  private async getTargetFieldInfo(
    client: Client,
    infraction: GroupedInfraction,
  ) {
    const targetId = this.getTargetId(infraction);

    if (infraction.userId) {
      const user = await client.users.fetch(targetId).catch(() => null);
      return { name: user?.username ?? 'Unknown User', id: targetId };
    }

    const guild = await client.fetchGuild(targetId).catch(() => null);
    return {
      name: guild?.name ?? infraction.serverName ?? 'Unknown Server',
      id: targetId,
    };
  }

  private formatInfractionDetails(
    infraction: GroupedInfraction,
    moderator: DiscordUser | null,
    expiresAt: string,
  ): string {
    return stripIndents`
      - **Total Infractions**: ${infraction.count}
      - **Latest Infraction**:
        > \`\`\`yaml
        > Type: ${infraction.type}
        > Status: ${infraction.status}
        > Reason: ${infraction.reason}
        > Moderator: ${moderator?.username ?? 'Unknown.'}
        > Expires: ${expiresAt}
        > \`\`\`
    `;
  }

  private shouldCreateNewPage(
    counter: number,
    fieldsLength: number,
    totalSize: number,
  ): boolean {
    return (
      counter >= HubInfractionsSubcommand.INFRACTIONS_PER_PAGE ||
			fieldsLength === totalSize
    );
  }

  private createPageEmbed(fields: { name: string; value: string }[]) {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('All Infractions for this hub')
          .setFields(fields)
          .setColor(Constants.Colors.invisible)
          .setFooter({
            text: 'To view a specific user or server\'s infractions, use the command with the target\'s ID.',
          }),
      ],
    };
  }

  private async displayPagination(
    interaction: Context,
    pages: BaseMessageOptions[],
  ) {
    const paginator = new Pagination(interaction.client).addPages(pages);
    await paginator.run(interaction);
  }
}
