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
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { CustomID } from '#src/utils/CustomID.js';
import {
  formatServerLeaderboard,
  formatUserLeaderboard,
  getLeaderboard,
} from '#src/utils/Leaderboard.js';
import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js';

export default class MessagesLeaderboardCommand extends BaseCommand {
  constructor() {
    super({
      name: 'messages',
      description: 'Shows the global message leaderboards for InterChat.',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context) {
    // Default to user leaderboard
    const userLeaderboard = await getLeaderboard('user', 10);
    const userLeaderboardFormatted = await formatUserLeaderboard(userLeaderboard, ctx.client);

    // Create UI components helper
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader(
        'Global Message Leaderboard',
        'Resets every month. Send a message in any hub to get on it!',
        'hash_icon',
      ),
    );

    // Add leaderboard content
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        userLeaderboardFormatted.length > 0 ? userLeaderboardFormatted : 'No data available.',
      ),
    );

    // Add toggle buttons
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('messages_lb:user').toString())
          .setLabel('Users')
          .setEmoji('👥')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(new CustomID('messages_lb:server').toString())
          .setLabel('Servers')
          .setEmoji('🏠')
          .setStyle(ButtonStyle.Secondary),
      ),
    );

    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('messages_lb')
  async handleLeaderboardSwitch(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const currentType = ctx.customId.suffix as 'user' | 'server';

    const leaderboard = await getLeaderboard(currentType, 10);
    const leaderboardFormatted =
      currentType === 'user'
        ? await formatUserLeaderboard(leaderboard, ctx.client)
        : await formatServerLeaderboard(leaderboard, ctx.client);

    // Create UI components helper
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader(
        'Global Message Leaderboard',
        'Resets every month. Send a message in any hub to get on it!',
        'hash_icon',
      ),
    );

    // Add leaderboard content
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        leaderboardFormatted.length > 0 ? leaderboardFormatted : 'No data available.',
      ),
    );

    // Add toggle buttons with current selection
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('messages_lb:user').toString())
          .setLabel('Users')
          .setEmoji('👥')
          .setStyle(currentType === 'user' ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(currentType === 'user'),
        new ButtonBuilder()
          .setCustomId(new CustomID('messages_lb:server').toString())
          .setLabel('Servers')
          .setEmoji('🏠')
          .setStyle(currentType === 'server' ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(currentType === 'server'),
      ),
    );

    await ctx.editOrReply({ components: [container] }, ['IsComponentsV2']);
  }
}
