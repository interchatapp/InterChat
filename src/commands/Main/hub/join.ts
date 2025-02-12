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

import type Context from '#src/core/CommandContext/Context.js';
import { HubJoinService } from '#src/services/HubJoinService.js';
import { ApplicationCommandOptionType, type AutocompleteInteraction, ChannelType, type GuildTextBasedChannel } from 'discord.js';
import BaseCommand from '#src/core/BaseCommand.js';
import HubCommand, { hubOption } from '#src/commands/Main/hub/index.js';
import { escapeRegexChars } from '#src/utils/Utils.js';
import { HubService } from '#src/services/HubService.js';

export default class HubJoinSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'join',
      description: '🔗 Join a public/private hub from this server.',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.Channel,
          name: 'channel',
          description: 'The channel you want to use connect to a hub.',
          required: false,
          channel_types: [
            ChannelType.GuildText,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
          ],
        },
        { ...hubOption, required: false },
        {
          type: ApplicationCommandOptionType.String,
          name: 'invite',
          description: 'The invite code of the private hub you want to join.',
          required: false,
        },
      ],

    });
  }
  async execute(ctx: Context) {
    if (!ctx.inGuild()) return;

    const hubInviteOrName =
			ctx.options.getString('invite') ??
			ctx.options.getString('hub') ??
			undefined;

    const channel = ((await ctx.options.getChannel('channel')) ??
			ctx.channel) as GuildTextBasedChannel;
    const locale = await ctx.getLocale();

    // get random hub if no invite or name is provided
    const hubJoinService = new HubJoinService(ctx, locale);

    if (hubInviteOrName) await hubJoinService.joinHub(channel, hubInviteOrName);
    else await hubJoinService.joinRandomHub(channel);
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focusedValue = escapeRegexChars(interaction.options.getFocused());
    const hubChoices = await HubCommand.getPublicHubs(
      focusedValue,
      this.hubService,
    );
    await interaction.respond(
      hubChoices.map((hub) => ({ name: hub.data.name, value: hub.data.name })),
    );
  }
}
