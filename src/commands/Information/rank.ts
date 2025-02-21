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
import { calculateRequiredXP } from '#src/utils/calculateLevel.js';
import Constants from '#src/utils/Constants.js';
import { drawRankProgressBar } from '#src/utils/ImageUtils.js';
import { handleError } from '#src/utils/Utils.js';
import { type CanvasRenderingContext2D, createCanvas, loadImage } from 'canvas';
import {
  ApplicationCommandOptionType,
  AttachmentBuilder,
  type User,
} from 'discord.js';
import { join } from 'node:path';

interface RankCardDimensions {
  width: number;
  height: number;
  avatarSize: number;
  avatarX: number;
  avatarY: number;
}

interface UserStats {
  level: number;
  xp: number;
  messageCount: number;
  stats: {
    xp: {
      rank: number;
    };
  };
}

const __dirname = new URL('.', import.meta.url).pathname;

export default class RankCommand extends BaseCommand {
  private static readonly DIMENSIONS: RankCardDimensions = {
    width: 900,
    height: 250,
    avatarSize: 110,
    avatarX: 40,
    avatarY: 60, // (height - avatarSize) / 2
  };

  private static readonly FONTS = {
    USERNAME: 'bold 32px "Arial"',
    LEVEL: 'bold 28px "Arial"',
    RANK: 'bold 28px "Arial"',
    XP_PROGRESS: '20px "Arial"',
    TOTAL_XP: '24px "Arial"',
  };

  constructor() {
    super({
      name: 'rank',
      description: 'Display user rank and statistics',
      types: { slash: true, prefix: true },
      options: [
        {
          name: 'user',
          description: 'The user to get the rank of',
          type: ApplicationCommandOptionType.User,
          required: false,
        },
      ],
    });
  }

  async execute(ctx: Context) {
    await ctx.reply('This command is currently disabled. Use `/leaderboard user` instead.');
  }

  async executeOld(ctx: Context): Promise<void> {
    await ctx.deferReply();

    try {
      // const targetUser = await ctx.options.getUser('user') ?? ctx.user;
      // const stats = await ctx.client.userLevels.getStats(
      //   targetUser.id,
      //   targetUser.username,
      // );
      // const rankCard = await this.createRankCard(targetUser, stats);

      // await ctx.editReply({ files: [rankCard] });
    }
    catch (error) {
      handleError(error, {
        comment: 'Failed to create rank card',
        repliable: ctx.originalInteraction,
      });
    }
  }

  private async createRankCard(user: User, stats: UserStats): Promise<AttachmentBuilder> {
    const canvas = createCanvas(RankCommand.DIMENSIONS.width, RankCommand.DIMENSIONS.height);
    const ctx = canvas.getContext('2d');

    await this.drawBackground(ctx);
    await this.drawUserAvatar(ctx, user);
    this.drawUserInfo(ctx, user, stats);
    this.drawProgressBar(ctx, stats);

    return new AttachmentBuilder(canvas.toBuffer(), { name: 'rank.png' });
  }

  private async drawBackground(ctx: CanvasRenderingContext2D): Promise<void> {
    const background = await loadImage(join(__dirname, '../../../assets/rankBg.png'));
    ctx.drawImage(background, 0, 0, RankCommand.DIMENSIONS.width, RankCommand.DIMENSIONS.height);

    // Add semi-transparent overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, RankCommand.DIMENSIONS.width, RankCommand.DIMENSIONS.height);
  }

  private async drawUserAvatar(ctx: CanvasRenderingContext2D, user: User): Promise<void> {
    const { avatarX, avatarY, avatarSize } = RankCommand.DIMENSIONS;
    const avatar = await loadImage(user.displayAvatarURL({ extension: 'png', size: 256 }));

    // Draw avatar background/border
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 5, 0, Math.PI * 2);
    ctx.fill();

    // Create circular avatar
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
  }

  private drawUserInfo(ctx: CanvasRenderingContext2D, user: User, stats: UserStats): void {
    const { avatarX, avatarY, avatarSize, width } = RankCommand.DIMENSIONS;
    const textX = avatarX + avatarSize + 30;

    // Username
    ctx.font = RankCommand.FONTS.USERNAME;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(user.username, textX, avatarY + 40);

    // Level
    ctx.font = RankCommand.FONTS.LEVEL;
    ctx.fillStyle = Constants.Colors.interchatBlue;
    ctx.fillText(`Level ${stats.level}`, textX, avatarY + 80);

    // Rank
    const rankText = `Rank #${stats.stats.xp.rank}`;
    ctx.font = RankCommand.FONTS.RANK;
    const rankWidth = ctx.measureText(rankText).width;
    ctx.fillText(rankText, width - 40 - rankWidth, avatarY + 40);

    // Messages
    const messageText = `${stats.messageCount} messages`;
    const messageWidth = ctx.measureText(messageText).width;
    ctx.fillText(messageText, width - 40 - messageWidth, avatarY + 80);

    // Total XP
    ctx.font = RankCommand.FONTS.TOTAL_XP;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`Total XP: ${stats.xp}`, textX, avatarY + 160);
  }

  private drawProgressBar(ctx: CanvasRenderingContext2D, stats: UserStats): void {
    const { avatarX, avatarY, avatarSize, width } = RankCommand.DIMENSIONS;
    const barWidth = width - (avatarX + avatarSize + 60) - 40;
    const textX = avatarX + avatarSize + 30;

    const currentLevelTotalXP = calculateRequiredXP(stats.level);
    const nextLevelTotalXP = calculateRequiredXP(stats.level + 1);
    const requiredXP = nextLevelTotalXP - currentLevelTotalXP;
    const currentLevelXP = Math.max(stats.xp - currentLevelTotalXP, 0);
    const progress = requiredXP > 0 ? currentLevelXP / requiredXP : 0;

    drawRankProgressBar(ctx, textX, avatarY + 100, barWidth, 25, progress);
  }
}
