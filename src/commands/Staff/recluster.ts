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
import { isDev } from '#utils/Utils.js';
import type Context from '#src/core/CommandContext/Context.js';

export default class Respawn extends BaseCommand {
  constructor() {
    super({
      name: 'recluster',
      description: 'Reboot the bot',
      staffOnly: true,
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context) {
    if (!isDev(ctx.user.id)) {
      await ctx.reply({ content: 'No u', flags: ['Ephemeral'] });
      return;
    }

    await ctx.reply({
      content: `${ctx.getEmoji('tick')} I'll be back!`,
      flags: ['Ephemeral'],
    });
    ctx.client.cluster.send('recluster');
  }
}
