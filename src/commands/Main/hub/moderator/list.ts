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
import { t } from '#src/utils/Locale.js';
import { Role } from '#src/generated/prisma/client/client.js';
import { EmbedBuilder, type AutocompleteInteraction } from 'discord.js';

export default class HubModeratorListSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'list',
      description: '📜 List all moderators on a hub',
      types: { slash: true, prefix: true },
      options: [hubOption],
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

    const locale = await ctx.getLocale();
    const moderators = await hub.moderators.fetchAll();
    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Hub Moderators')
          .setDescription(
            moderators.size > 0
              ? moderators
                .map(
                  (mod, index) =>
                    `${index + 1}. <@${mod.userId}> - ${
                      mod.role === Role.MODERATOR
                        ? 'Moderator'
                        : 'Hub Manager'
                    }`,
                )
                .join('\n')
              : t('hub.moderator.noModerators', locale, {
                emoji: ctx.getEmoji('x_icon'),
              }),
          )
          .setColor('Aqua')
          .setTimestamp(),
      ],
      flags: ['Ephemeral'],
    });
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    return await HubCommand.handleManagerCmdAutocomplete(interaction, this.hubService);
  }
}
