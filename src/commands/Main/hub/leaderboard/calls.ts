import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  resolveColor,
} from 'discord.js';
import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import Constants from '#src/utils/Constants.js';
import { formatServerLeaderboard, formatUserLeaderboard, getCallLeaderboard } from '#src/utils/Leaderboard.js';
import { CustomID } from '#src/utils/CustomID.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';

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

    const embed = new EmbedBuilder()
      .setTitle(`${ctx.getEmoji('call_icon')} Global Calls Leaderboard`)
      .setDescription(userLeaderboardFormatted.length > 0 ? userLeaderboardFormatted : 'No data available.')
      .setColor(resolveColor(Constants.Colors.invisible))
      .setFooter({ text: 'Shows data from the last 30 days' });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID('calls_lb:user').toString())
        .setLabel('User Leaderboard')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(new CustomID('calls_lb:server').toString())
        .setLabel('Server Leaderboard')
        .setStyle(ButtonStyle.Secondary),
    );

    await ctx.reply({
      embeds: [embed],
      components: [row],
    });
  }

  @RegisterInteractionHandler('calls_lb')
  async handleLeaderboardSwitch(interaction: ButtonInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const currentType = customId.suffix as 'user' | 'server';

    const leaderboard = await getCallLeaderboard(currentType, 10);
    const leaderboardFormatted = currentType === 'user'
      ? await formatUserLeaderboard(leaderboard, interaction.client, 'calls')
      : await formatServerLeaderboard(leaderboard, interaction.client, 'calls');

    const embed = new EmbedBuilder()
      .setTitle(`${getEmoji('call_icon', interaction.client)} Global Calls Leaderboard`)
      .setDescription(leaderboardFormatted.length > 0 ? leaderboardFormatted : 'No data available.')
      .setColor(resolveColor(Constants.Colors.invisible))
      .setFooter({ text: 'Shows data from the last 30 days' });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
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
    );

    await interaction.update({
      embeds: [embed],
      components: [row],
    });
  }
}
