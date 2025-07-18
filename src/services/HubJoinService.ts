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

import BlacklistManager from '#src/managers/BlacklistManager.js';
import HubManager from '#src/managers/HubManager.js';
import AchievementService from '#src/services/AchievementService.js';
import { HubService } from '#src/services/HubService.js';
import { type EmojiKeys, getEmoji } from '#src/utils/EmojiUtils.js';
import type { TranslationKeys } from '#types/TranslationKeys.d.ts';
import { createConnection } from '#utils/ConnectedListUtils.js';
import db from '#utils/Db.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import { getOrCreateWebhook } from '#utils/Utils.js';
import { logJoinToHub } from '#utils/hub/logger/JoinLeave.js';
import { sendToHub } from '#utils/hub/utils.js';
import { stripIndents } from 'common-tags';
import type { GuildTextBasedChannel } from 'discord.js';

import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import Context from '#src/core/CommandContext/Context.js';
import { checkStringForAntiSwear } from '#src/utils/network/antiSwearChecks.js';
import Constants from '#src/utils/Constants.js';

export class HubJoinService {
  private readonly locale: supportedLocaleCodes;
  private readonly hubService: HubService;
  // Add a property to store the guild ID which is guaranteed to be non-null
  private readonly guildId: string;

  constructor(
    private readonly ctx: Context | ComponentContext,
    locale: supportedLocaleCodes,
    hubService: HubService = new HubService(),
  ) {
    this.locale = locale;
    this.hubService = hubService;
    // Since we're using CacheContext or cached interactions, guildId is guaranteed to be non-null
    // But TypeScript doesn't recognize this, so we need to assert it
    this.guildId = ctx.guildId as string;
  }

  private getEmoji(name: EmojiKeys) {
    return getEmoji(name, this.ctx.client);
  }

  async joinRandomHub(channel: GuildTextBasedChannel) {
    const hub = await db.hub.findMany({
      where: { private: false },
      orderBy: { connections: { _count: 'asc' } },
      take: 10,
    });

    const randomHub = hub[Math.floor(Math.random() * hub.length)];
    return await this.joinHub(channel, { hubInviteOrName: randomHub.name });
  }

  async joinHub(
    channel: GuildTextBasedChannel,
    {
      hubInviteOrName,
      hubId,
    }: {
      hubInviteOrName?: string;
      hubId?: string;
    },
  ) {
    if (!this.ctx.deferred && !this.ctx.replied) {
      await this.ctx.deferReply({ flags: ['Ephemeral'] });
    }

    const hub = hubId
      ? await this.hubService.fetchHub(hubId)
      : await this.fetchHub(hubInviteOrName);

    if (!hub) {
      await this.ctx.editReply({
        content: t('hub.notFound', this.locale, {
          emoji: this.getEmoji('x_icon'),
          hubs_link: `${Constants.Links.Website}/hubs}`,
        }),
      });
      return false;
    }

    const checksPassed = await this.runChecks(channel, hub);
    if (!checksPassed) return false;

    if ((await this.isAlreadyInHub(channel, hub.id)) || (await this.isBlacklisted(hub))) {
      return false;
    }

    const webhook = await this.createWebhook(channel);
    if (!webhook) return false;

    // Create the connection
    await createConnection({
      channelId: channel.id,
      parentId: channel.isThread() ? channel.parentId : undefined,
      webhookURL: webhook.url,
      connected: true,
      compact: true,
      hub: { connect: { id: hub.id } },
      server: {
        connectOrCreate: {
          create: { id: channel.guildId, name: channel.guild.name },
          where: { id: channel.guildId },
        },
      },
    });

    await this.sendSuccessMessages(hub, channel);
    const connectionCount = await hub.connections.fetchCount();

    // Track achievements
    const achievementService = new AchievementService();
    await achievementService.processEvent(
      'hub_join',
      { userId: this.ctx.user.id, hubId: hub.id, serverCount: connectionCount },
      this.ctx.client,
    );

    // If user is admin, track Bridge Builder achievement
    if (this.ctx.inGuild() && this.ctx.member.permissions.has('Administrator', true)) {
      await achievementService.processEvent(
        'serverJoin',
        { userId: this.ctx.user.id, isAdmin: true, hubConnected: true },
        this.ctx.client,
      );
    }

    await achievementService.updateHubServerCountAchievements(
      hub.id,
      connectionCount,
      this.ctx.client,
    );

    return true;
  }

  private async runChecks(channel: GuildTextBasedChannel, hub: HubManager) {
    if (!this.ctx.inGuild()) return false;

    if (!this.ctx.member?.permissions.has('ManageMessages', true)) {
      await this.replyError('errors.missingPermissions', {
        permissions: 'Manage Messages',
        emoji: this.getEmoji('x_icon'),
      });
      return false;
    }

    // Check NSFW channel safety restrictions
    const channelIsNsfw = 'nsfw' in channel && channel.nsfw;
    const hubIsNsfw = hub.data.nsfw;

    if (channelIsNsfw && !hubIsNsfw) {
      await this.ctx.reply({
        content: t('hub.join.nsfwChannelSfwHub', this.locale, {
          emoji: this.getEmoji('x_icon'),
          channel: `<#${channel.id}>`,
          hub: hub.data.name,
        }),
        flags: ['Ephemeral'],
      });
      return false;
    }

    if (!channelIsNsfw && hubIsNsfw) {
      await this.ctx.reply({
        content: t('hub.join.sfwChannelNsfwHub', this.locale, {
          emoji: this.getEmoji('x_icon'),
          channel: `<#${channel.id}>`,
          hub: hub.data.name,
        }),
        flags: ['Ephemeral'],
      });
      return false;
    }

    // Check server name against anti-swear rules
    if (await checkStringForAntiSwear(channel.guild.name, hub.id)) {
      await this.replyError('errors.serverNameInappropriate', { emoji: this.getEmoji('x_icon') });
      return false;
    }

    return true;
  }

  private async fetchHub(hubNameOrInvite?: string) {
    const hubName = hubNameOrInvite ?? 'InterChat Central';

    // Check if it's an invite code
    if (hubNameOrInvite) {
      const fetchedInvite = await db.hubInvite.findFirst({
        where: { code: hubNameOrInvite },
        include: { hub: true },
      });

      if (fetchedInvite) return new HubManager(fetchedInvite.hub);
    }

    // Otherwise search by name
    return await this.hubService.fetchHub({ name: hubName });
  }

  private async isAlreadyInHub(channel: GuildTextBasedChannel, hubId: string) {
    const channelInHub = await db.connection.findFirst({
      where: {
        OR: [{ channelId: channel.id }, { serverId: channel.guildId, hubId }],
      },
      include: { hub: { select: { name: true } } },
    });

    if (channelInHub) {
      await this.replyError('hub.alreadyJoined', {
        channel: `<#${channelInHub.channelId}>`,
        hub: `${channelInHub.hub?.name}`,
        emoji: this.getEmoji('x_icon'),
      });
      return true;
    }
    return false;
  }

  private async isBlacklisted(hub: HubManager) {
    const userBlManager = new BlacklistManager('user', this.ctx.user.id);
    const serverBlManager = new BlacklistManager('server', this.guildId);

    const userBlacklist = await userBlManager.fetchBlacklist(hub.id);
    const serverBlacklist = await serverBlManager.fetchBlacklist(hub.id);

    if (userBlacklist || serverBlacklist) {
      await this.replyError('errors.blacklisted', {
        emoji: this.getEmoji('x_icon'),
        hub: hub.data.name,
      });
      return true;
    }

    return false;
  }

  private async createWebhook(channel: GuildTextBasedChannel) {
    const webhook = await getOrCreateWebhook(channel);
    if (!webhook) {
      await this.replyError('errors.botMissingPermissions', {
        permissions: 'Manage Webhooks',
        emoji: this.getEmoji('x_icon'),
      });
      return null;
    }
    return webhook;
  }

  private async sendSuccessMessages(hub: HubManager, channel: GuildTextBasedChannel) {
    const replyData = {
      content: t('hub.join.success', this.locale, {
        channel: `${channel}`,
        hub: hub.data.name,
      }),
      embeds: [],
      components: [],
    } as const;

    await this.ctx.reply(replyData);

    // Announce join with custom welcome message
    await this.announceJoin(hub);
  }

  private async announceJoin(hub: HubManager) {
    const totalConnections =
      (await hub.connections.fetch())?.reduce(
        (total, c) => total + (c.data.connected ? 1 : 0),
        0,
      ) ?? 0;

    const serverCountMessage =
      totalConnections === 0
        ? 'There are no other servers connected to this hub yet. *cricket noises* 🦗'
        : `We now have ${totalConnections} servers in this hub! 🎉`;

    // Since we're using CacheContext or cached interactions, guild is guaranteed to be non-null
    // But we need to get a reference to it
    const guild = this.ctx.guild;
    // This assertion is safe because of our constructor's type constraints
    if (!guild) {
      throw new Error('Guild is null despite using cached context. This should never happen.');
    }

    const serverName = guild.name;
    const memberCount = guild.memberCount;

    // Custom welcome message if set
    const welcomeMessage =
      hub.data.welcomeMessage
        ?.replace('{user}', this.ctx.user.username)
        ?.replace('{hubName}', hub.data.name)
        ?.replace('{serverName}', serverName)
        ?.replace('{memberCount}', memberCount.toString())
        ?.replace('{totalConnections}', totalConnections.toString()) ??
      stripIndents`
        A new server has joined the hub! ${this.getEmoji('clipart')}

        **Server Name:** __${serverName}__
        **Member Count:** __${memberCount}__

        ${serverCountMessage}
      `;

    // Announce to hub
    await sendToHub(hub.id, {
      username: `InterChat | ${hub.data.name}`,
      avatarURL: hub.data.iconUrl,
      content: welcomeMessage,
    });

    // Send log - guild is guaranteed to be non-null here
    await logJoinToHub(hub.id, guild, {
      totalConnections,
      hubName: hub.data.name,
    });
  }

  private async replyError<K extends keyof TranslationKeys>(
    key: K,
    options?: { [key in TranslationKeys[K]]: string },
  ) {
    const content = t(key, this.locale, options);

    await this.ctx.reply({ content, flags: ['Ephemeral'] });
  }
}
