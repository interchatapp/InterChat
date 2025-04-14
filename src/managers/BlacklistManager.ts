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

import type {
  Appeal,
  Infraction,
  InfractionStatus,
  Prisma,
  User as UserData,
} from '#src/generated/prisma/client/client.js';
import InfractionManager from '#src/managers/InfractionManager.js';
import { HubService } from '#src/services/HubService.js';
import UserDbService from '#src/services/UserDbService.js';
import Constants from '#src/utils/Constants.js';
import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { resolveEval } from '#src/utils/Utils.js';
import { sendLog } from '#src/utils/hub/logger/Default.js';
import { stripIndents } from 'common-tags';
import { type Client, EmbedBuilder, type Snowflake, type User } from 'discord.js';

/**
 * Interface for blacklist options when adding a new blacklist
 */
interface BlacklistOptions {
  hubId: string;
  reason: string;
  moderatorId: string;
  expiresAt: Date | null;
  notified?: boolean;
  serverName?: string;
}

/**
 * Interface for blacklist log options
 */
interface BlacklistLogOptions {
  mod: User;
  reason: string;
  expiresAt: Date | null;
}

/**
 * Interface for blacklist with appeal information
 */
type BlacklistWithAppeal = Infraction & {
  appeal: (Appeal & { user: UserData | null }) | null;
};

/**
 * Manages blacklists for users and servers across hubs
 */
export default class BlacklistManager {
  public readonly targetId: Snowflake;
  public readonly infractions: InfractionManager;
  private readonly type: 'user' | 'server';
  private readonly userManager = new UserDbService();

  /**
   * Creates a new BlacklistManager instance
   * @param type - The type of entity being managed ('user' or 'server')
   * @param targetId - The Discord ID of the user or server
   */
  constructor(type: 'user' | 'server', targetId: Snowflake) {
    this.type = type;
    this.targetId = targetId;
    this.infractions = new InfractionManager(type, targetId);
  }

  /**
   * Adds a blacklist for the target in the specified hub
   * @param opts - Blacklist options including hub, reason, moderator, and expiration
   * @returns The created infraction record
   */
  public async addBlacklist(opts: BlacklistOptions): Promise<Infraction> {
    // Check if already blacklisted
    const blacklisted = await this.fetchBlacklist(opts.hubId);

    if (blacklisted) {
      // Revoke existing blacklist before creating a new one
      await this.infractions.revokeInfraction('BLACKLIST', opts.hubId, 'REVOKED');
    }
    else if (this.type === 'user' && !(await this.userManager.getUser(this.targetId))) {
      // Create user record if it doesn't exist (for user blacklists only)
      await this.userManager.createUser({ id: this.targetId });
    }

    // Create the new blacklist infraction
    return await this.infractions.addInfraction('BLACKLIST', opts);
  }

  /**
   * Removes a blacklist for the target in the specified hub
   * @param hubId - The ID of the hub
   * @param status - The status to set when removing (defaults to 'REVOKED')
   * @returns The updated infraction or null if not found
   */
  public async removeBlacklist(
    hubId: string,
    status: Exclude<InfractionStatus, 'ACTIVE'> = 'REVOKED',
  ): Promise<Infraction | null> {
    const exists = await this.fetchBlacklist(hubId);
    if (!exists) return null;

    return await this.infractions.revokeInfraction('BLACKLIST', hubId, status);
  }

  /**
   * Updates an existing blacklist
   * @param hubId - The ID of the hub
   * @param data - The data to update
   * @returns The updated infraction or null if not found
   */
  public async updateBlacklist(
    hubId: string,
    data: Prisma.InfractionUpdateInput,
  ): Promise<Infraction | null> {
    const blacklisted = await this.fetchBlacklist(hubId);
    if (!blacklisted) return null;

    return await this.infractions.updateInfraction(
      { hubId, type: 'BLACKLIST', status: 'ACTIVE' },
      data,
    );
  }

  /**
   * Fetches an active blacklist for the target in the specified hub
   * @param hubId - The ID of the hub
   * @param include - Options for including related data
   * @returns The blacklist with optional appeal information, or null if not found
   */
  public async fetchBlacklist(
    hubId: string,
    include: { appeal: boolean } = { appeal: false },
  ): Promise<BlacklistWithAppeal | null> {
    // Get the active blacklist infraction
    const blacklist = await this.infractions.fetchInfraction('BLACKLIST', hubId, 'ACTIVE');

    // If no blacklist found, return null
    if (!blacklist) return null;

    // Fetch appeal information if requested
    let appeal: BlacklistWithAppeal['appeal'] = null;
    if (include.appeal) {
      appeal = await db.appeal.findFirst({
        where: { infractionId: blacklist.id },
        include: { user: true },
        orderBy: { createdAt: 'desc' },
      });
    }

    // Return blacklist with appeal information
    return { ...blacklist, appeal };
  }

  /**
   * Logs the blacklisting of a user or server to the hub's mod logs
   * @param hubId - The ID of the hub where the blacklist was applied
   * @param client - The Discord client instance
   * @param opts - Options containing moderator, reason, and expiration information
   */
  public async log(hubId: string, client: Client, opts: BlacklistLogOptions): Promise<void> {
    const { mod, reason, expiresAt } = opts;

    // Fetch hub and log configuration
    const hub = await new HubService().fetchHub(hubId);
    const logConfig = await hub?.fetchLogConfig();

    // Exit if mod logs are not configured
    if (!logConfig?.config.modLogs) return;

    // Get target information based on type (server or user)
    const targetInfo = await this.getTargetInfo(client);
    if (!targetInfo) return;

    const { name, iconURL, type } = targetInfo;
    const dotBlueEmoji = getEmoji('dot', client);

    // Create embed for mod logs
    const embed = new EmbedBuilder()
      .setAuthor({ name: `${type} ${name} blacklisted`, iconURL })
      .setDescription(
        stripIndents`
				${dotBlueEmoji} **${type}:** ${name} (${this.targetId})
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

    // Send log to the configured channel
    await sendLog(mod.client.cluster, logConfig.config.modLogs.channelId, embed);
  }

  /**
   * Gets information about the target (user or server)
   * @param client - The Discord client instance
   * @returns Target information including name, icon URL, and type, or null if not found
   */
  private async getTargetInfo(
    client: Client,
  ): Promise<{ name: string; iconURL: string | undefined; type: 'User' | 'Server' } | null> {
    if (this.infractions.targetType === 'server') {
      // For servers, use broadcastEval to find the server across shards
      const target =
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

      if (!target) return null;

      return {
        name: target.name,
        iconURL: target.iconURL,
        type: 'Server',
      };
    }
    else {
      // For users, fetch the user directly
      try {
        const user = await client.users.fetch(this.targetId);
        return {
          name: user.username,
          iconURL: user.displayAvatarURL(),
          type: 'User',
        };
      }
      catch {
        // Silently fail and return null when user can't be fetched
        return null;
      }
    }
  }

  /**
   * Determines if an infraction is a server blacklist
   * @param data - The infraction to check
   * @returns Whether the infraction is a server blacklist
   */
  public static isServerBlacklist(data: Infraction | null): boolean {
    return Boolean(data?.serverId !== null && data?.serverName !== null);
  }

  /**
   * Checks if a blacklist is active and not expired
   * @param blacklist - The blacklist to check
   * @returns Whether the blacklist is active and not expired
   */
  public static isActiveBlacklist(blacklist: Infraction | null): boolean {
    if (!blacklist) return false;
    if (blacklist.status !== 'ACTIVE') return false;
    if (blacklist.expiresAt && blacklist.expiresAt <= new Date()) return false;

    return true;
  }
}
