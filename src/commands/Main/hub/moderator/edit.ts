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
import { Role, type HubModerator } from '#src/generated/prisma/client/client.js';
import { ApplicationCommandOptionType, type AutocompleteInteraction } from 'discord.js';

export default class HubModeratorEditSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'edit',
      description: '📝 Update the position of a hub moderator',
      types: { slash: true, prefix: true },
      options: [
        hubOption,
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'The mod you want to edit.',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'position',
          description: 'The moderator position to change.',
          required: true,
          choices: [
            { name: 'Network Moderator', value: Role.MODERATOR },
            { name: 'Hub Manager', value: Role.MANAGER },
          ],
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
    const role = ctx.options.getString(
      'position',
      true,
    ) as HubModerator['role'];

    if (!user || !(await hub.isManager(ctx.user.id))) {
      await ctx.replyEmbed('hub.moderator.update.notAllowed', {
        t: {
          emoji: ctx.getEmoji('x_icon'),
        },
        flags: ['Ephemeral'],
      });
      return;
    }

    const userPosition = await hub.moderators.fetch(user.id);
    if (!userPosition) {
      await ctx.replyEmbed('hub.moderator.update.notModerator', {
        t: {
          user: user.toString(),
          emoji: ctx.getEmoji('x_icon'),
        },
        flags: ['Ephemeral'],
      });
      return;
    }
    if (userPosition.role === 'MANAGER' && !hub.isOwner(ctx.user.id)) {
      await ctx.replyEmbed('hub.moderator.update.notOwner', {
        t: {
          emoji: ctx.getEmoji('x_icon'),
        },
        flags: ['Ephemeral'],
      });
      return;
    }

    await hub.moderators.update(user.id, role);

    await ctx.replyEmbed('hub.moderator.update.success', {
      t: {
        user: user.toString(),
        position: role,
        emoji: ctx.getEmoji('tick_icon'),
      },
    });
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    return await HubCommand.handleManagerCmdAutocomplete(interaction, this.hubService);
  }
}
