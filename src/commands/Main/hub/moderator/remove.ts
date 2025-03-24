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
import { HubService } from '#src/services/HubService.js';
import { runHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { ApplicationCommandOptionType, type AutocompleteInteraction } from 'discord.js';

export default class HubModeratorRemoveSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'remove',
      description: '🧹 Remove a user from moderator position in your hub',
      types: { slash: true, prefix: true },
      options: [
        hubOption,
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'The user who should be removed',
          required: true,
        },
      ],

    });
  }

  public async execute(ctx: Context) {
    const hubName = ctx.options.getString('hub', true);
    const hub = hubName
      ? (await this.hubService.findHubsByName(hubName)).at(0)
      : undefined;
    if (
      !hub ||
			!(await runHubRoleChecksAndReply(hub, ctx, {
			  checkIfManager: true,
			}))
    ) return;

    const user = await ctx.options.getUser('user');
    if (!user || !(await hub.isMod(user.id))) {
      await ctx.replyEmbed('hub.moderator.remove.notModerator', {
        t: {
          user: user?.toString() ?? 'Unknown User',
          emoji: ctx.getEmoji('x_icon'),
        },
        flags: ['Ephemeral'],
      });
      return;
    }

    const mod = await hub.moderators.fetch(user.id);
    const isRestrictedAction =
			mod?.role === 'MANAGER' || user.id === ctx.user.id;

    /* executor needs to be owner to:
     - change position of other managers
     - change their own position
     */
    if (!hub.isOwner(ctx.user.id) && isRestrictedAction) {
      await ctx.replyEmbed('hub.moderator.remove.notOwner', {
        t: {
          emoji: ctx.getEmoji('x_icon'),
        },
        flags: ['Ephemeral'],
      });
      return;
    }

    await hub.moderators.remove(user.id);

    await ctx.replyEmbed('hub.moderator.remove.success', {
      t: {
        user: user.toString(),
        emoji: ctx.getEmoji('tick_icon'),
      },
    });
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    return await HubCommand.handleManagerCmdAutocomplete(interaction, this.hubService);
  }
}
