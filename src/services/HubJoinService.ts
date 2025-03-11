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
import { HubService } from '#src/services/HubService.js';
import { type EmojiKeys, getEmoji } from '#src/utils/EmojiUtils.js';
import Context from '#src/core/CommandContext/Context.js';
import type { TranslationKeys } from '#types/TranslationKeys.d.ts';
import { createConnection } from '#utils/ConnectedListUtils.js';
import db from '#utils/Db.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import { getOrCreateWebhook, getReplyMethod } from '#utils/Utils.js';
import { logJoinToHub } from '#utils/hub/logger/JoinLeave.js';
import { sendToHub } from '#utils/hub/utils.js';
import { stripIndents } from 'common-tags';
import type {
  ChatInputCommandInteraction,
  GuildTextBasedChannel,
  MessageComponentInteraction,
} from 'discord.js';
// eslint-disable-next-line no-duplicate-imports
import type { CacheContext } from '#src/core/CommandContext/Context.js';
import { checkRule } from '#src/utils/network/antiSwearChecks.js';

export class HubJoinService {
  private readonly interaction:
    | ChatInputCommandInteraction<'cached'>
    | MessageComponentInteraction<'cached'>
    | Context<CacheContext>;
  private readonly locale: supportedLocaleCodes;
  private readonly hubService: HubService;

  constructor(
    interaction:
      | ChatInputCommandInteraction<'cached'>
      | MessageComponentInteraction<'cached'>
      | Context<CacheContext>,
    locale: supportedLocaleCodes,
    hubService: HubService = new HubService(),
  ) {
    this.interaction = interaction;
    this.locale = locale;
    this.hubService = hubService;
  }

  private getEmoji(name: EmojiKeys) {
    return getEmoji(name, this.interaction.client);
  }

  async joinRandomHub(channel: GuildTextBasedChannel) {
    const hub = await db.hub.findMany({
      where: { private: false },
      orderBy: { connections: { _count: 'asc' } },
      take: 10,
    });

    const randomHub = hub[Math.floor(Math.random() * hub.length)];
    return await this.joinHub(channel, randomHub.name);
  }

  async joinHub(channel: GuildTextBasedChannel, hubInviteOrName: string | undefined) {
    if (!this.interaction.deferred) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      await this.interaction.deferReply({ flags: ['Ephemeral'] });
    }

    const hub = await this.fetchHub(hubInviteOrName);
    if (!hub) {
      await this.interaction.editReply({
        content: t('hub.notFound', this.locale, {
          emoji: this.getEmoji('x_icon'),
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
    return true;
  }

  private async runChecks(channel: GuildTextBasedChannel, hub: HubManager) {
    if (!channel.permissionsFor(this.interaction.member).has('ManageMessages', true)) {
      await this.replyError('errors.missingPermissions', {
        permissions: 'Manage Messages',
        emoji: this.getEmoji('x_icon'),
      });
      return false;
    }

    for (const rule of await hub.fetchAntiSwearRules()) {
      const match = checkRule(channel.guild.name, rule);
      if (match) {
        await this.replyError('errors.serverNameInappropriate', { emoji: this.getEmoji('x_icon') });
        return false;
      }
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
    const userBlManager = new BlacklistManager('user', this.interaction.user.id);
    const serverBlManager = new BlacklistManager('server', this.interaction.guildId);

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
    if (this.interaction instanceof Context) {
      await this.interaction.reply(replyData);
      return;
    }

    const replyMethod = getReplyMethod(this.interaction);
    await this.interaction[replyMethod](replyData);

    const totalConnections =
      (await hub.connections.fetch())?.reduce(
        (total, c) => total + (c.data.connected ? 1 : 0),
        0,
      ) ?? 0;

    const serverCountMessage =
      totalConnections === 0
        ? 'There are no other servers connected to this hub yet. *cricket noises* 🦗'
        : `We now have ${totalConnections} servers in this hub! 🎉`;

    // Announce to hub
    await sendToHub(hub.id, {
      username: `InterChat | ${hub.data.name}`,
      avatarURL: hub.data.iconUrl,
      content: stripIndents`
        A new server has joined the hub! ${this.getEmoji('clipart')}

        **Server Name:** __${this.interaction.guild.name}__
        **Member Count:** __${this.interaction.guild.memberCount}__

        ${serverCountMessage}
      `,
    });

    // Send log
    await logJoinToHub(hub.id, this.interaction.guild, {
      totalConnections,
      hubName: hub.data.name,
    });
  }

  private async replyError<K extends keyof TranslationKeys>(
    key: K,
    options?: { [key in TranslationKeys[K]]: string },
  ) {
    const content = t(key, this.locale, options);

    if (this.interaction instanceof Context) {
      await this.interaction.reply({ content, flags: ['Ephemeral'] });
      return;
    }

    const replyMethod = getReplyMethod(this.interaction);
    await this.interaction[replyMethod]({ content, flags: ['Ephemeral'] });
  }
}
