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

import HubCommand from '#src/commands/Main/hub/index.js';
import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import { HubService } from '#src/services/HubService.js';
import db from '#src/utils/Db.js';
import { escapeRegexChars } from '#src/utils/Utils.js';
import { ApplicationCommandOptionType, type AutocompleteInteraction } from 'discord.js';

export default class HubInviteRevokeSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'revoke',
      description: '🚫 Revoke an invite code to your hub',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'code',
          description: 'The invite code',
          required: true,
        },
      ],
    });
  }
  public async execute(ctx: Context) {
    const code = ctx.options.getString('code', true);

    const inviteInDb = await db.hubInvite.findFirst({
      where: {
        code,
        hub: {
          OR: [
            { ownerId: ctx.user.id },
            {
              moderators: {
                some: { userId: ctx.user.id, role: 'MANAGER' },
              },
            },
          ],
        },
      },
    });

    if (!inviteInDb) {
      await ctx.replyEmbed('hub.invite.revoke.invalidCode', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    await db.hubInvite.delete({ where: { code } });
    await ctx.replyEmbed('hub.invite.revoke.success', {
      t: {
        emoji: ctx.getEmoji('tick_icon'),
        inviteCode: code,
      },
      flags: ['Ephemeral'],
    });
  }
  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focusedValue = escapeRegexChars(interaction.options.getFocused());
    const hubChoices = await HubCommand.getModeratedHubs(
      focusedValue,
      interaction.user.id,
      this.hubService,
    );

    await interaction.respond(
      hubChoices.map((hub) => ({
        name: hub.data.name,
        value: hub.data.name,
      })),
    );
  }
}
