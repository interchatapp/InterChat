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
import Context from '#src/core/CommandContext/Context.js';
import { HubService } from '#src/services/HubService.js';
import { runHubRoleChecksAndReply } from '#src/utils/hub/utils.js';
import { t } from '#src/utils/Locale.js';
import { showModeratedHubsAutocomplete } from '#src/utils/moderation/blacklistUtils.js';
import { warnUser } from '#utils/moderation/warnUtils.js';
import { ApplicationCommandOptionType, type AutocompleteInteraction } from 'discord.js';

export default class WarnCommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'warn',
      description: 'Warn a user in your hub',
      types: { prefix: true, slash: true },
      options: [
        {
          name: 'user',
          description: 'The user to warn',
          type: ApplicationCommandOptionType.User,
          required: true,
        },
        {
          name: 'hub',
          description: 'The hub to warn in',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true,
        },
        {
          name: 'reason',
          description: 'Reason for the warning',
          type: ApplicationCommandOptionType.String,
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

    if (!hub || !(await runHubRoleChecksAndReply(hub, ctx, { checkIfMod: true }))) {
      return;
    }

    const user = await ctx.options.getUser('user', true);
    const reason = ctx.options.getString('reason', true);

    if (user.id === ctx.user.id) {
      const locale = await ctx.getLocale();
      await ctx.reply({
        content: t('warn.errors.cannotWarnSelf', locale, {
          emoji: ctx.getEmoji('x_icon'),
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    await warnUser({
      userId: user.id,
      hubId: hub.id,
      reason,
      moderatorId: ctx.user.id,
      client: ctx.client,
    });

    await ctx.replyEmbed('warn.success', {
      t: {
        emoji: ctx.getEmoji('tick_icon'),
        name: user.username,
      },
    });
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await showModeratedHubsAutocomplete(interaction, this.hubService);
  }
}
