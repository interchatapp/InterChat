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
import { logUserUnblacklist } from '#src/utils/hub/logger/ModLogs.js';
import { runHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { showModeratedHubsAutocomplete } from '#src/utils/moderation/blacklistUtils.js';
import { ApplicationCommandOptionType, type AutocompleteInteraction } from 'discord.js';

export default class UnblacklistserverSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'server',
      description: 'Unblacklist a server from your hub.',
      types: { prefix: true, slash: true },
      options: [
        {
          name: 'hub',
          description: 'Hub to unblacklist from',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true,
        },
        {
          name: 'server',
          description: 'The ID server to unblacklist',
          type: ApplicationCommandOptionType.String,
          required: true,
        },
      ],
    });
  }

  async execute(ctx: Context): Promise<void> {
    await ctx.deferReply({ flags: ['Ephemeral'] });

    const hubName = ctx.options.getString('hub', true);
    const serverId = ctx.options.getString('server', true);

    const hub = (await this.hubService.findHubsByName(hubName)).at(0);
    if (
      !hub ||
			!(await runHubRoleChecksAndReply(hub, ctx, { checkIfMod: true }))
    ) return;

    const blacklistManager = new BlacklistManager('server', serverId);
    const blacklist = await blacklistManager.fetchBlacklist(hub.id);
    if (!blacklist) {
      await ctx.replyEmbed('errors.userNotBlacklisted', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    await blacklistManager.removeBlacklist(hub.id);
    await logUserUnblacklist(ctx.client, hub, { id: serverId, mod: ctx.user });

    await ctx.replyEmbed('blacklist.removed', {
      t: {
        emoji: ctx.getEmoji('tick_icon'),
        name: (await ctx.client.fetchGuild(serverId))?.name ?? 'Unknown User',
      },
    });
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await showModeratedHubsAutocomplete(interaction, this.hubService);
  }
}
