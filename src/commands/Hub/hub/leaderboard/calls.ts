import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { CustomID } from '#src/utils/CustomID.js';
import { formatServerLeaderboard, formatUserLeaderboard, getCallLeaderboard } from '#src/utils/Leaderboard.js';
import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js';

export default class CallsLeaderboardCommand extends BaseCommand {
  constructor() {
    super({
      name: 'calls',
      description: 'Shows the global calls leaderboard for InterChat.',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context) {
    // Default to user leaderboard
    const userLeaderboard = await getCallLeaderboard('user', 10);
    const userLeaderboardFormatted = await formatUserLeaderboard(userLeaderboard, ctx.client, 'calls');

    // Create UI components helper
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader('Global Calls Leaderboard', 'Shows data from this month', 'call_icon'),
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
          .setCustomId(new CustomID('calls_lb:user').toString())
          .setLabel('User Leaderboard')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(new CustomID('calls_lb:server').toString())
          .setLabel('Server Leaderboard')
          .setStyle(ButtonStyle.Secondary),
      ),
    );

    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('calls_lb')
  async handleLeaderboardSwitch(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const currentType = ctx.customId.suffix as 'user' | 'server';

    const leaderboard = await getCallLeaderboard(currentType, 10);
    const leaderboardFormatted = currentType === 'user'
      ? await formatUserLeaderboard(leaderboard, ctx.client, 'calls')
      : await formatServerLeaderboard(leaderboard, ctx.client, 'calls');

    // Create UI components helper
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader('Global Calls Leaderboard', 'Shows data from this month', 'call_icon'),
    );

    // Add leaderboard content
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        leaderboardFormatted.length > 0 ? leaderboardFormatted : 'No data available.',
      ),
    );

    // Add toggle buttons
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('calls_lb:user').toString())
          .setLabel('User Leaderboard')
          .setStyle(currentType === 'user' ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(currentType === 'user'),
        new ButtonBuilder()
          .setCustomId(new CustomID('calls_lb:server').toString())
          .setLabel('Server Leaderboard')
          .setStyle(currentType === 'server' ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(currentType === 'server'),
      ),
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }
}
