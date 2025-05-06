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
import { escapeRegexChars } from '#src/utils/Utils.js';
import { ApplicationCommandOptionType, type AutocompleteInteraction } from 'discord.js';
import ms from 'ms';

export default class HubInviteCreateSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'create',
      description: '🔗 Create a new invite code to your private hub',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'hub',
          description: 'The name of the hub you wish to create this invite for',
          required: true,
          autocomplete: true,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'expiry',
          description:
						'The expiry of the invite link. Eg. 10h (10 hours from now)',
          required: false,
        },
      ],
    });
  }
  public async execute(ctx: Context) {
    const hubName = ctx.options.getString('hub', true);
    const expiryStr = ctx.options.getString('expiry');
    const duration = expiryStr ? ms(expiryStr as ms.StringValue) : undefined;
    const expires = new Date(Date.now() + (duration || 60 * 60 * 4000));

    const hubService = new HubService();
    const hub = (await hubService.findHubsByName(hubName)).at(0);

    if (!hub) {
      await ctx.replyEmbed('hub.notFound_mod', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }
    if (!hub?.data.private) {
      await ctx.replyEmbed('hub.notPrivate', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    if (!(await hub.isManager(ctx.user.id))) {
      await ctx.replyEmbed('hub.notManager', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    if (!Date.parse(expires.toString())) {
      await ctx.reply({
        content: `${ctx.getEmoji('x_icon')} Invalid Expiry Duration provided!`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const createdInvite = await hub.createInvite(expires);

    await ctx.replyEmbed('hub.invite.create.success', {
      t: {
        inviteCode: createdInvite.code,
        expiry: `<t:${Math.round(createdInvite.expires.getTime() / 1000)}:R>`,
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
