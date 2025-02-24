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
import db from '#src/utils/Db.js';
import { ApplicationCommandOptionType, Invite } from 'discord.js';

export default class ConfigSetInviteSubcommand extends BaseCommand {
  constructor() {
    super({
      name: 'set-invite',
      description:
        'Set the invite link for the server. People can use it to join through InterChat leaderboards.',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'invite',
          description: 'The invite link to set for the server. (Leave empty to remove)',
          required: false,
        },
      ],
    });
  }
  async execute(ctx: Context) {
    if (!ctx.inGuild()) return;
    await ctx.deferReply();

    const inviteLink = ctx.options.getString('invite');
    if (!inviteLink?.length) {
      await db.serverData.upsert({
        where: { id: ctx.guild.id },
        create: { id: ctx.guildId },
        update: { inviteCode: null },
      });

      await ctx.replyEmbed('config.setInvite.removed', {
        edit: true,
        t: { emoji: ctx.getEmoji('tick_icon') },
      });
      return;
    }

    const inviteCode = inviteLink.match(Invite.InvitesPattern)?.[1];
    if (!inviteCode) {
      await ctx.replyEmbed('config.setInvite.invalid', {
        edit: true,
        t: { emoji: ctx.getEmoji('x_icon') },
      });
      return;
    }

    const inviteInGuild = (await ctx.guild.invites.fetch()).get(inviteCode);
    if (!inviteInGuild) {
      await ctx.replyEmbed('config.setInvite.notFromServer', {
        edit: true,
        t: { emoji: ctx.getEmoji('x_icon') },
      });
      return;
    }

    await db.serverData.upsert({
      where: { id: ctx.guild.id },
      create: { id: ctx.guildId, inviteCode },
      update: { inviteCode },
    });

    await ctx.replyEmbed('config.setInvite.success', {
      edit: true,
      t: { emoji: ctx.getEmoji('tick_icon') },
    });
  }
}
