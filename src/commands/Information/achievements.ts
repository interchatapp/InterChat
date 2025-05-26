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
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import UserDbService from '#src/services/UserDbService.js';
import { CustomID } from '#src/utils/CustomID.js';
import {
  ApplicationCommandOptionType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  type User,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import AchievementService from '#src/services/AchievementService.js';

// Constants for interaction handling
const ACHIEVEMENTS_COMMAND_BASE = 'achievements';

interface AchievementWithProgress {
  id: string;
  name: string;
  description: string;
  badgeEmoji: string;
  badgeUrl?: string | null;
  threshold: number;
  secret?: boolean;
  unlocked: boolean;
  progress: number;
  unlockedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Command to view user achievements with enhanced UI
 */
export default class AchievementsCommand extends BaseCommand {
  private achievementService: AchievementService;

  constructor() {
    super({
      name: 'achievements',
      description: '🏆 View your achievements or another user\'s achievements',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'The user to view achievements for (defaults to yourself)',
          required: false,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'view',
          description: 'Choose which achievements to view',
          required: false,
          choices: [
            { name: 'All', value: 'all' },
            { name: 'Unlocked', value: 'unlocked' },
            { name: 'Locked', value: 'locked' },
            { name: 'In Progress', value: 'progress' },
          ],
        },
      ],
    });

    this.achievementService = new AchievementService();
  }

  /**
   * Execute the achievements command
   * @param ctx Command context
   */
  async execute(ctx: Context): Promise<void> {
    await ctx.deferReply();

    // Get command options
    const targetUser = (await ctx.options.getUser('user')) ?? ctx.user;
    const viewOption = ctx.options.getString('view') ?? 'all';

    // Create service instance
    const userService = new UserDbService();

    // Ensure user exists in database
    await userService.upsertUser(targetUser.id, {
      name: targetUser.username,
      image: targetUser.displayAvatarURL(),
    });

    // Get achievement data
    const achievementData = await this.getUserAchievementData(targetUser.id, viewOption);

    // Show achievements with embed UI
    await this.showAchievements(ctx, targetUser, achievementData, viewOption, 1);
  }

  /**
   * Get user achievement data with progress information
   */
  private async getUserAchievementData(
    userId: string,
    viewFilter: string = 'all',
  ): Promise<AchievementWithProgress[]> {
    // Get all achievements and user's unlocked ones
    const allAchievements = await this.achievementService.getAchievements();
    const userAchievements = await this.achievementService.getUserAchievements(userId);

    // Create a map of unlocked achievements for quick lookup
    const unlockedMap = new Map(userAchievements.map((ua) => [ua.achievementId, ua]));
    const achievementsWithProgress: AchievementWithProgress[] = [];

    // Process each achievement to add progress data
    for (const achievement of allAchievements) {
      const unlocked = unlockedMap.has(achievement.id);
      const userAchievement = unlockedMap.get(achievement.id);

      // Skip secret achievements that aren't unlocked unless viewing all
      if (achievement.secret && !unlocked && viewFilter !== 'all') continue;

      // Get progress for non-unlocked achievements
      let progress = unlocked ? achievement.threshold : 0;
      if (!unlocked) {
        progress = await this.achievementService.getProgress(userId, achievement.id);
      }

      const achievementWithProgress: AchievementWithProgress = {
        ...achievement,
        unlocked,
        progress,
        unlockedAt: userAchievement?.unlockedAt,
      };

      // Apply view filter
      switch (viewFilter) {
        case 'unlocked':
          if (unlocked) achievementsWithProgress.push(achievementWithProgress);
          break;
        case 'locked':
          if (!unlocked) achievementsWithProgress.push(achievementWithProgress);
          break;
        case 'progress':
          if (!unlocked && progress > 0) achievementsWithProgress.push(achievementWithProgress);
          break;
        default:
          achievementsWithProgress.push(achievementWithProgress);
      }
    }

    return achievementsWithProgress;
  }

  /**
   * Show achievements with embed UI
   */
  private async showAchievements(
    ctx: Context,
    targetUser: User,
    achievements: AchievementWithProgress[],
    viewFilter: string,
    page: number,
  ): Promise<void> {
    const itemsPerPage = 8;
    const totalPages = Math.ceil(achievements.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageAchievements = achievements.slice(startIndex, endIndex);

    // If no achievements, show empty state
    if (achievements.length === 0) {
      await this.showEmptyState(ctx, targetUser, viewFilter);
      return;
    }

    // Create embed
    const unlockedCount = achievements.filter((a) => a.unlocked).length;
    const totalCount = achievements.length;

    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${targetUser.username}'s Achievements`)
      .setDescription(`**Progress:** ${unlockedCount}/${totalCount} achievements unlocked`)
      .setColor('#FFD700')
      .setThumbnail(targetUser.displayAvatarURL({ size: 128 }));

    // Add achievements as fields
    for (const achievement of pageAchievements) {
      const statusEmoji = achievement.unlocked ? '🏆' : achievement.secret ? '❓' : ctx.getEmoji('lock_icon');
      const progressBar = this.createProgressBar(achievement.progress, achievement.threshold);

      let fieldValue = achievement.description;

      if (!achievement.unlocked && !achievement.secret) {
        fieldValue += `\nProgress: ${progressBar} ${achievement.progress}/${achievement.threshold}`;
      }
      else if (achievement.unlocked && achievement.unlockedAt) {
        fieldValue += `\n:tada: Unlocked: <t:${Math.floor(achievement.unlockedAt.getTime() / 1000)}:R>`;
      }

      embed.addFields({
        name: `${statusEmoji} ${achievement.name}`,
        value: fieldValue,
        inline: true,
      });
    }

    // Add page info if needed
    if (totalPages > 1) {
      embed.setFooter({ text: `Page ${page}/${totalPages}` });
    }

    // Create filter select menu
    const filterSelect = new StringSelectMenuBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier(ACHIEVEMENTS_COMMAND_BASE, 'filter')
          .setArgs(targetUser.id)
          .toString(),
      )
      .setPlaceholder('Filter achievements...')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('All Achievements')
          .setValue('all')
          .setDefault(viewFilter === 'all'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Unlocked')
          .setValue('unlocked')
          .setDefault(viewFilter === 'unlocked'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Locked')
          .setValue('locked')
          .setDefault(viewFilter === 'locked'),
        new StringSelectMenuOptionBuilder()
          .setLabel('In Progress')
          .setValue('progress')
          .setDefault(viewFilter === 'progress'),
      );

    const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(filterSelect),
    ];

    // Add pagination buttons if needed
    if (totalPages > 1) {
      const navigationButtons = [];

      if (page > 1) {
        navigationButtons.push(
          new ButtonBuilder()
            .setCustomId(
              new CustomID()
                .setIdentifier(ACHIEVEMENTS_COMMAND_BASE, 'page')
                .setArgs(targetUser.id, viewFilter, (page - 1).toString())
                .toString(),
            )
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary),
        );
      }

      navigationButtons.push(
        new ButtonBuilder()
          .setCustomId('page_info')
          .setLabel(`Page ${page}/${totalPages}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      );

      if (page < totalPages) {
        navigationButtons.push(
          new ButtonBuilder()
            .setCustomId(
              new CustomID()
                .setIdentifier(ACHIEVEMENTS_COMMAND_BASE, 'page')
                .setArgs(targetUser.id, viewFilter, (page + 1).toString())
                .toString(),
            )
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary),
        );
      }

      const navRow = new ActionRowBuilder<MessageActionRowComponentBuilder>();
      navRow.addComponents(...navigationButtons);
      components.push(navRow);
    }

    await ctx.editOrReply({
      embeds: [embed],
      components,
    });
  }

  /**
   * Show empty state when no achievements match filter
   */
  private async showEmptyState(ctx: Context, targetUser: User, viewFilter: string): Promise<void> {
    let message = 'No achievements found';
    switch (viewFilter) {
      case 'unlocked':
        message =
          'No achievements unlocked yet. Keep exploring InterChat to earn your first achievement!';
        break;
      case 'locked':
        message = 'All achievements have been unlocked! Congratulations! 🎉';
        break;
      case 'progress':
        message =
          'No achievements in progress. Start chatting in hubs to begin earning achievements!';
        break;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${targetUser.username}'s Achievements`)
      .setDescription(message)
      .setColor('#FFD700')
      .setThumbnail(targetUser.displayAvatarURL({ size: 128 }));

    await ctx.editOrReply({
      embeds: [embed],
    });
  }

  /**
   * Create a visual progress bar
   */
  private createProgressBar(current: number, max: number): string {
    const percentage = Math.min(current / max, 1);
    const filledBars = Math.round(percentage * 10);
    const emptyBars = 10 - filledBars;
    return '█'.repeat(filledBars) + '░'.repeat(emptyBars);
  }

  /**
   * Handle filter selection
   */
  @RegisterInteractionHandler(ACHIEVEMENTS_COMMAND_BASE, 'filter')
  async handleFilterSelect(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const targetUserId = ctx.customId.args[0];
    const newFilter = ctx.values?.[0];
    if (!newFilter) return;

    // Fetch target user
    const targetUser = await ctx.client.users.fetch(targetUserId).catch(() => null);
    if (!targetUser) {
      await ctx.editOrReply({ content: 'User not found.', components: [] });
      return;
    }

    // Get updated achievement data
    const achievementData = await this.getUserAchievementData(targetUserId, newFilter);

    // Show updated achievements
    await this.showAchievements(ctx, targetUser, achievementData, newFilter, 1);
  }

  /**
   * Handle page navigation
   */
  @RegisterInteractionHandler(ACHIEVEMENTS_COMMAND_BASE, 'page')
  async handlePageNavigation(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const targetUserId = ctx.customId.args[0];
    const viewFilter = ctx.customId.args[1];
    const newPage = parseInt(ctx.customId.args[2], 10);

    // Fetch target user
    const targetUser = await ctx.client.users.fetch(targetUserId).catch(() => null);
    if (!targetUser) {
      await ctx.editOrReply({ content: 'User not found.', components: [] });
      return;
    }

    // Get achievement data
    const achievementData = await this.getUserAchievementData(targetUserId, viewFilter);

    // Show achievements for the new page
    await this.showAchievements(ctx, targetUser, achievementData, viewFilter, newPage);
  }
}
