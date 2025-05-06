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

import HubCommand from '#src/commands/Hub/hub/index.js';
import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import { HubService } from '#src/services/HubService.js';
import { runHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { type HubModerator, Role } from '#src/generated/prisma/client/client.js';
import { ApplicationCommandOptionType, type AutocompleteInteraction } from 'discord.js';

export default class HubModeratorAddSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'add',
      description: '👮 Add a new hub moderator',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'hub',
          description: 'The name of the hub you wish to add moderators to',
          required: true,
          autocomplete: true,
        },
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'User who will become hub moderator',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'position',
          description: 'Determines what hub permissions they have.',
          required: false,
          choices: [
            { name: 'Network Moderator', value: Role.MODERATOR },
            { name: 'Hub Manager', value: Role.MANAGER },
          ] as { name: string; value: Role }[],
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

    if (!user || (await hub.isMod(user.id))) {
      await ctx.replyEmbed('hub.moderator.add.alreadyModerator', {
        t: {
          user: user?.toString() ?? 'Unknown User',
          emoji: ctx.getEmoji('x_icon'),
        },
        flags: ['Ephemeral'],
      });
      return;
    }

    const role = (ctx.options.getString('position') ??
			Role.MODERATOR) as HubModerator['role'];

    await hub.moderators.add(user.id, role);

    await ctx.replyEmbed('hub.moderator.add.success', {
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
