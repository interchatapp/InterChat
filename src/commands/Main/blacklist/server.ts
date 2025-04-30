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
import { HubService } from '#src/services/HubService.js';
import { runHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { buildDurationButtons } from '#src/interactions/BlacklistCommandHandler.js';
import { showModeratedHubsAutocomplete } from '#src/utils/moderation/blacklistUtils.js';
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
} from 'discord.js';

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
          description:
						'The serverid to blacklist (get id using /messageinfo command)',
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
      ],
    });
  }

  async execute(ctx: Context): Promise<void> {
    await ctx.deferReply({ flags: ['Ephemeral'] });

    const hubName = ctx.options.getString('hub', true);
    const serverId = ctx.options.getString('serverid', true);

    const hub = (await this.hubService.findHubsByName(hubName)).at(0);
    if (
      !hub ||
			!(await runHubRoleChecksAndReply(hub, ctx, {
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

    // Check if the server is already blacklisted
    const blacklistManager = await import(
      '#src/managers/BlacklistManager.js'
    ).then((m) => new m.default('server', serverId));
    const alreadyBlacklisted = await blacklistManager.fetchBlacklist(hub.id);
    if (alreadyBlacklisted) {
      await ctx.replyEmbed('blacklist.server.alreadyBlacklisted', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    // Show duration selection buttons
    const durationButtons = buildDurationButtons('server', hub.id, serverId);
    await ctx.reply({
      content: `Select blacklist duration for ${server.name}:`,
      components: durationButtons,
      flags: ['Ephemeral'],
    });
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await showModeratedHubsAutocomplete(interaction, this.hubService);
  }
}
