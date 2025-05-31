import BaseCommand from '#src/core/BaseCommand.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js';

interface AchievementLeaderboardEntry {
  userId: string;
  username: string;
  totalAchievements: number;
  completionPercentage: number;
}

export default class AchievementsLeaderboardCommand extends BaseCommand {
  constructor() {
    super({
      name: 'achievements',
      description: 'View the global achievements leaderboard',
      types: { slash: true, prefix: true },
    });
  }

  async execute(ctx: Context) {
    await ctx.deferReply();

    // Get leaderboard data
    const leaderboard = await this.getAchievementsLeaderboard(10);
    const leaderboardFormatted = await this.formatAchievementsLeaderboard(leaderboard);

    // Create UI components helper
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader(
        'Global Achievements Leaderboard',
        'Top users by total achievements unlocked',
        'trophy_icon',
      ),
    );

    // Add leaderboard content
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        leaderboardFormatted.length > 0 ? leaderboardFormatted : 'No data available.',
      ),
    );

    // Add sorting buttons
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('achievements_lb:total').toString())
          .setLabel('By Total')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(new CustomID('achievements_lb:percentage').toString())
          .setLabel('By Completion %')
          .setStyle(ButtonStyle.Secondary),
      ),
    );

    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('achievements_lb')
  async handleLeaderboardSwitch(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const sortType = ctx.customId.suffix as 'total' | 'percentage';

    const leaderboard = await this.getAchievementsLeaderboard(10, sortType);
    const leaderboardFormatted = await this.formatAchievementsLeaderboard(leaderboard);

    // Create UI components helper
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header
    const headerText =
      sortType === 'total'
        ? 'Top users by total achievements unlocked'
        : 'Top users by completion percentage';

    container.addTextDisplayComponents(
      ui.createHeader('Global Achievements Leaderboard', headerText, 'trophy_icon'),
    );

    // Add leaderboard content
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        leaderboardFormatted.length > 0 ? leaderboardFormatted : 'No data available.',
      ),
    );

    // Add sorting buttons
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('achievements_lb:total').toString())
          .setLabel('By Total')
          .setStyle(sortType === 'total' ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(sortType === 'total'),
        new ButtonBuilder()
          .setCustomId(new CustomID('achievements_lb:percentage').toString())
          .setLabel('By Completion %')
          .setStyle(sortType === 'percentage' ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(sortType === 'percentage'),
      ),
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  private async getAchievementsLeaderboard(
    limit: number = 10,
    sortBy: 'total' | 'percentage' = 'total',
  ): Promise<AchievementLeaderboardEntry[]> {
    // Get total number of achievements
    const totalAchievements = await db.achievement.count();

    // Get users with their achievement counts
    const usersWithAchievements = await db.user.findMany({
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            achievements: true,
          },
        },
      },
      where: {
        achievements: {
          some: {},
        },
      },
      orderBy: {
        achievements: {
          _count: 'desc',
        },
      },
      take: limit * 2, // Get more to account for filtering
    });

    // Calculate completion percentages and format data
    const leaderboardData: AchievementLeaderboardEntry[] = usersWithAchievements
      .map((user) => ({
        userId: user.id,
        username: user.name || 'Unknown User',
        totalAchievements: user._count.achievements,
        completionPercentage:
          totalAchievements > 0
            ? Math.round((user._count.achievements / totalAchievements) * 100)
            : 0,
      }))
      .filter((entry) => entry.totalAchievements > 0);

    // Sort based on the requested criteria
    if (sortBy === 'percentage') {
      leaderboardData.sort((a, b) => {
        if (b.completionPercentage === a.completionPercentage) {
          return b.totalAchievements - a.totalAchievements;
        }
        return b.completionPercentage - a.completionPercentage;
      });
    }

    return leaderboardData.slice(0, limit);
  }

  private async formatAchievementsLeaderboard(
    leaderboard: AchievementLeaderboardEntry[],
  ): Promise<string> {
    if (leaderboard.length === 0) return 'No achievements data available.';

    let output = '';

    for (let i = 0; i < leaderboard.length; i++) {
      const entry = leaderboard[i];
      const rank = i + 1;

      // Get rank emoji
      let rankEmoji = '';
      if (rank === 1) rankEmoji = '🥇';
      else if (rank === 2) rankEmoji = '🥈';
      else if (rank === 3) rankEmoji = '🥉';
      else rankEmoji = `${rank}.`;

      output += `${rankEmoji} \`${entry.totalAchievements} achievements (${entry.completionPercentage}%)\` - ${entry.username}\n`;
    }

    return output;
  }
}
