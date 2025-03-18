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
import db from '#src/utils/Db.js';
import { logUserUnblacklist } from '#src/utils/hub/logger/ModLogs.js';
import { executeHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { showModeratedHubsAutocomplete } from '#src/utils/moderation/blacklistUtils.js';
import { fetchUserData } from '#src/utils/Utils.js';
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
} from 'discord.js';

export default class UnblacklistUserSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'user',
      description: 'Unblacklist a user from your hub.',
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
          name: 'user',
          description: 'The user to unblacklist',
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
    const userId = ctx.options.getString('user', true);

    const hub = (await this.hubService.findHubsByName(hubName)).at(0);
    if (
      !hub ||
			!(await executeHubRoleChecksAndReply(hub, ctx, { checkIfMod: true }))
    ) return;

    const blacklistManager = new BlacklistManager('user', userId);
    const blacklist = await blacklistManager.fetchBlacklist(hub.id);
    if (!blacklist) {
      await ctx.replyEmbed('errors.userNotBlacklisted', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
        edit: true,
      });
      return;
    }

    await blacklistManager.removeBlacklist(hub.id);
    await logUserUnblacklist(ctx.client, hub, { id: userId, mod: ctx.user });

    await ctx.replyEmbed('blacklist.removed', {
      t: {
        emoji: ctx.getEmoji('tick_icon'),
        name: (await fetchUserData(userId))?.name ?? 'Unknown User',
      },
      edit: true,
    });
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const hubAutocomplete = interaction.options.get('hub');
    const userAutocomplete = interaction.options.get('user');
    if (hubAutocomplete?.focused) {
      await showModeratedHubsAutocomplete(interaction, this.hubService);
    }
    else if (userAutocomplete?.focused) {
      const userValue = interaction.options.getFocused();
      const activeInfractions = await db.infraction.findMany({
        where: {
          type: 'BLACKLIST',
          status: 'ACTIVE',
          OR: [
            { userId: { mode: 'insensitive', contains: userValue } },
            {
              user: { name: { mode: 'insensitive', contains: userValue } },
            },
          ],
        },
        include: { user: true },
        take: 25,
      });

      await interaction.respond(
        activeInfractions.map((user) => ({
          name: `${user.user?.name ?? 'Unknown User'} (${user.userId})`,
          value: user.userId ?? 'Unknown UserId',
        })),
      );
    }
  }
}
