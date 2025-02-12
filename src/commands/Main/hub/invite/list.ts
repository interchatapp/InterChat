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
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { t } from '#src/utils/Locale.js';
import { escapeRegexChars } from '#src/utils/Utils.js';
import { ApplicationCommandOptionType, type AutocompleteInteraction } from 'discord.js';

export default class HubInviteListSubcommand extends BaseCommand {
  private readonly hubService = new HubService();
  constructor() {
    super({
      name: 'list',
      description: '📜 List all moderators on a hub',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'hub',
          description: 'The name of the hub',
          required: true,
          autocomplete: true,
        },
      ],
    });
  }

  async execute(ctx: Context): Promise<void> {
    const hubName = ctx.options.getString('hub', true);

    const hub = (await this.hubService.findHubsByName(hubName)).at(0);

    if (!(await hub?.isManager(ctx.user.id))) {
      await ctx.replyEmbed('hub.notManager', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    if (!hub?.data.private) {
      await ctx.replyEmbed('hub.invite.list.notPrivate', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    const invitesInDb = await hub.fetchInvites();
    if (invitesInDb.length === 0) {
      await ctx.replyEmbed('hub.invite.list.noInvites', {
        t: { emoji: ctx.getEmoji('x_icon') },
        flags: ['Ephemeral'],
      });
      return;
    }

    const inviteArr = invitesInDb.map(
      (inv, index) =>
        `${index + 1}. \`${inv.code}\` - <t:${Math.round(inv.expires.getTime() / 1000)}:R>`,
    );

    const inviteEmbed = new InfoEmbed()
      .setTitle(t('hub.invite.list.title', await ctx.getLocale()))
      .setDescription(inviteArr.join('\n'));

    await ctx.reply({
      embeds: [inviteEmbed],
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
