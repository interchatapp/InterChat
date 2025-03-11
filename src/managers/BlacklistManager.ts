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

import type { Infraction, InfractionStatus, Prisma } from '@prisma/client';
import { stripIndents } from 'common-tags';
import { type Client, EmbedBuilder, type Snowflake, type User } from 'discord.js';
import InfractionManager from '#src/managers/InfractionManager.js';
import UserDbService from '#src/services/UserDbService.js';
import { HubService } from '#src/services/HubService.js';
import type { RemoveMethods } from '#src/types/Utils.d.js';
import Constants from '#src/utils/Constants.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { resolveEval } from '#src/utils/Utils.js';
import { sendLog } from '#src/utils/hub/logger/Default.js';

export default class BlacklistManager {
  public readonly targetId: Snowflake;
  public readonly infractions;
  private readonly type: 'user' | 'server';
  private readonly userManager = new UserDbService();

  constructor(type: 'user' | 'server', targetId: Snowflake) {
    this.type = type;
    this.targetId = targetId;
    this.infractions = new InfractionManager(type, targetId);
  }

  public async addBlacklist(opts: {
    hubId: string;
    reason: string;
    moderatorId: string;
    expiresAt: Date | null;
    notified?: boolean,
    serverName?: string;
  }): Promise<Infraction> {
    const blacklisted = await this.fetchBlacklist(opts.hubId);

    if (blacklisted) {
      await this.infractions.revokeInfraction('BLACKLIST', opts.hubId, 'REVOKED');
    }
    else if (this.type === 'user' && !(await this.userManager.getUser(this.targetId))) {
      await this.userManager.createUser({ id: this.targetId }); // Create user if not found
    }

    return await this.infractions.addInfraction('BLACKLIST', opts);
  }

  public async removeBlacklist(
    hubId: string,
    status: Exclude<InfractionStatus, 'ACTIVE'> = 'REVOKED',
  ) {
    const exists = await this.fetchBlacklist(hubId);
    if (!exists) return null;

    return await this.infractions.revokeInfraction('BLACKLIST', hubId, status);
  }

  public async updateBlacklist(hubId: string, data: Prisma.InfractionUpdateInput) {
    const blacklisted = await this.fetchBlacklist(hubId);
    if (!blacklisted) return null;

    return await this.infractions.updateInfraction(
      { hubId, type: 'BLACKLIST', status: 'ACTIVE' },
      data,
    );
  }

  public async fetchBlacklist(hubId: string) {
    const blacklist = await this.infractions.fetchInfraction('BLACKLIST', hubId, 'ACTIVE');
    return blacklist;
  }
  /**
   * Logs the blacklisting of a user or server.
   * @param userOrServer - The user or server being blacklisted.
   * @param mod - The moderator performing the blacklisting.
   * @param reason - The reason for the blacklisting.
   * @param expires - The optional expiration date for the blacklisting.
   */
  async log(
    hubId: string,
    client: Client,
    opts: { mod: User; reason: string; expiresAt: Date | null },
  ) {
    const { mod, reason, expiresAt } = opts;

    const hub = await new HubService().fetchHub(hubId);
    const logConfig = await hub?.fetchLogConfig();

    if (!logConfig?.config.modLogs) return;

    let name: string;
    let iconURL: string | undefined;
    let type: 'User' | 'Server';
    let target:
      | RemoveMethods<{
        name: string;
        iconURL: string | undefined;
        id: string;
      }>
      | User
      | null = null;

    if (this.infractions.targetType === 'server') {
      target =
        resolveEval(
          await client.cluster.broadcastEval(
            (c, guildId) => {
              const guild = c.guilds.cache.get(guildId);
              if (!guild) return null;

              return {
                name: guild.name,
                iconURL: guild.iconURL() ?? undefined,
                id: guildId,
              };
            },
            { context: this.targetId },
          ),
        ) ?? null;
      if (!target) return;

      name = target.name;
      iconURL = target.iconURL;
      type = 'Server';
    }
    else {
      target = await client.users.fetch(this.targetId);
      name = target.username;
      iconURL = target.displayAvatarURL();
      type = 'User';
    }

    const dotBlueEmoji = getEmoji('dot', client);
    const embed = new EmbedBuilder()
      .setAuthor({ name: `${type} ${name} blacklisted`, iconURL })
      .setDescription(
        stripIndents`
				${dotBlueEmoji} **${type}:** ${name} (${target.id})
				${dotBlueEmoji} **Moderator:** ${mod.username} (${mod.id})
				${dotBlueEmoji} **Hub:** ${hub?.data.name}
			`,
      )
      .addFields(
        { name: 'Reason', value: reason, inline: true },
        {
          name: 'Expires',
          value: expiresAt ? `<t:${Math.round(expiresAt.getTime() / 1000)}:R>` : 'Never.',
          inline: true,
        },
      )
      .setColor(Constants.Colors.interchat)
      .setFooter({
        text: `Blacklisted by: ${mod.username}`,
        iconURL: mod.displayAvatarURL(),
      });

    await sendLog(opts.mod.client.cluster, logConfig?.config.modLogs.channelId, embed);
  }

  public static isServerBlacklist(data: Infraction | null) {
    return data?.serverId !== null && data?.serverName === null;
  }
}
