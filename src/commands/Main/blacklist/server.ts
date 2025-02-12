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
import BlacklistManager from '#src/managers/BlacklistManager.js';
import { HubService } from '#src/services/HubService.js';
import { executeHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { sendBlacklistNotif, showModeratedHubsAutocomplete } from '#src/utils/moderation/blacklistUtils.js';
import { ApplicationCommandOptionType, type AutocompleteInteraction } from 'discord.js';
import ms from 'ms';

export default class BlacklistServerSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'server',
      description: 'Mute/Ban a server from your hub.',
      types: { prefix: true, slash: true },
      options: [
        {
          name: 'serverid',
          description: 'The serverid to blacklist (get id using /messageinfo command)',
          type: ApplicationCommandOptionType.String,
          required: true,
        },
        {
          name: 'reason',
          description: 'Reason for blacklist',
          type: ApplicationCommandOptionType.String,
          required: true,
        },
        {
          name: 'hub',
          description: 'Hub to blacklist from',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true,
        },
        {
          name: 'duration',
          description: 'Duration for blacklist',
          type: ApplicationCommandOptionType.String,
          required: false,
        },
      ],
    });
  }

  async execute(ctx: Context): Promise<void> {
    await ctx.deferReply({ flags: ['Ephemeral'] });

    const hubName = ctx.options.getString('hub', true);
    const serverId = ctx.options.getString('serverid', true);
    const reason = ctx.options.getString('reason', true);
    const duration = ctx.options.getString('duration');

    const hub = (await this.hubService.findHubsByName(hubName)).at(0);
    if (
      !hub ||
			!(await executeHubRoleChecksAndReply(hub, ctx, {
			  checkIfMod: true,
			}))
    ) return;

    const server = await ctx.client.fetchGuild(serverId);
    if (!server) {
      await ctx.replyEmbed('errors.userNotFound', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    const blacklistManager = new BlacklistManager('server', serverId);
    const alreadyBlacklisted = await blacklistManager.fetchBlacklist(hub.id);
    if (alreadyBlacklisted) {
      await ctx.replyEmbed('blacklist.server.alreadyBlacklisted', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    const expiresAt =
			duration && duration?.length > 1
			  ? new Date(Date.now() + ms(duration as ms.StringValue))
			  : null;

    await blacklistManager.addBlacklist({
      hubId: hub.id,
      reason,
      moderatorId: ctx.user.id,
      expiresAt,
      serverName: server.name,
    });

    await blacklistManager.log(hub.id, ctx.client, {
      mod: ctx.user,
      reason,
      expiresAt,
    });

    sendBlacklistNotif('server', ctx.client, {
      hubId: hub.id,
      target: { id: server.id },
      reason,
      expiresAt,
    }).catch(() => null);

    await ctx.replyEmbed('blacklist.success', {
      t: { emoji: ctx.getEmoji('tick_icon'), name: server.name },
    });
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await showModeratedHubsAutocomplete(interaction, this.hubService);
  }
}
