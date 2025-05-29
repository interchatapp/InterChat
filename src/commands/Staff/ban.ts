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
import { UIComponents } from '#src/utils/DesignSystem.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import {
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  type User,
} from 'discord.js';
import { stripIndents } from 'common-tags';

export default class Ban extends BaseCommand {
  constructor() {
    super({
      name: 'ban',
      description: '🔨 Ban users or servers from InterChat with comprehensive options',
      staffOnly: true,
      types: { slash: true },
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'duration',
          description: 'Ban duration',
          required: true,
          choices: [
            { name: '⏰ 1 Hour', value: '1h' },
            { name: '📅 1 Day', value: '1d' },
            { name: '📆 1 Week', value: '1w' },
            { name: '🗓️ 30 Days', value: '30d' },
            { name: '♾️ Permanent', value: 'permanent' },
          ],
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'reason',
          description: 'Reason for the ban (required)',
          required: true,
          max_length: 500,
        },
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'User to ban (required for user bans)',
          required: false,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'server_id',
          description: 'Server ID to ban (required for server bans)',
          required: false,
        },
      ],
    });
  }

  async execute(ctx: Context) {
    const user = await ctx.options.getUser('user');
    const serverId = ctx.options.getString('server_id');
    const duration = ctx.options.getString('duration', true);
    const reason = ctx.options.getString('reason', true);

    // Validation
    if (user && serverId) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Please specify either a user or a server, not both.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    if (!user && !serverId) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Please specify either a user or a server to ban.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Show confirmation dialog
    await this.showBanConfirmation(ctx, user ? 'user' : 'server', user, serverId, duration, reason);
  }

  private async showBanConfirmation(
    ctx: Context,
    banType: 'user' | 'server',
    user: User | null,
    serverId: string | null,
    duration: string,
    reason: string,
  ) {
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Get target information
    let targetInfo = '';
    let targetId = '';

    if (banType === 'user' && user) {
      targetInfo = `**User:** ${user.username} (${user.id})`;
      targetId = user.id;
    }
    else if (banType === 'server' && serverId) {
      const server = await ctx.client.guilds.fetch(serverId).catch(() => null);
      targetInfo = `**Server:** ${server?.name || 'Unknown'} (${serverId})`;
      targetId = serverId;
    }

    const durationText = duration === 'permanent' ? 'Permanent' : duration.toUpperCase();

    // Add confirmation header
    container.addTextDisplayComponents(
      ui.createHeader('Confirm Ban', 'Review ban details before execution', 'alert_icon'),
    );

    // Add ban details
    const banDetails = stripIndents`
    ${targetInfo}
    **Type:** ${banType === 'user' ? '👤 User Ban' : '🌐 Server Ban'}
    **Duration:** ${durationText}
    **Reason:** ${reason}
    **Moderator:** ${ctx.user.username}
    `;

    container.addTextDisplayComponents(ui.createSubsection('Ban Details', banDetails));

    // Add confirmation buttons
    container.addActionRowComponents((row) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(
            new CustomID('ban:execute', [banType, targetId, duration, reason]).toString(),
          )
          .setLabel('Confirm Ban')
          .setStyle(ButtonStyle.Danger)
          .setEmoji(getEmoji('hammer_icon', ctx.client)),
        new ButtonBuilder()
          .setCustomId(new CustomID('ban:cancel', []).toString())
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(getEmoji('x_icon', ctx.client)),
      );
      return row;
    });

    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
    });
  }
}
