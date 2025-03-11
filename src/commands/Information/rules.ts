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
import { fetchUserLocale } from '#src/utils/Utils.js';
import Constants from '#utils/Constants.js';
import { t } from '#utils/Locale.js';
import { EmbedBuilder } from 'discord.js';

export default class Rules extends BaseCommand {
  constructor() {
    super({
      name: 'rules',
      description: '📋 Sends the network rules for InterChat.',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context) {
    const locale = await fetchUserLocale(ctx.user.id);
    const rulesEmbed = new EmbedBuilder()
      .setDescription(t('rules.rules', locale, { emoji: ctx.getEmoji('rules_icon') }))
      .setColor(Constants.Colors.interchat);

    await ctx.reply({ embeds: [rulesEmbed] });
  }
}
