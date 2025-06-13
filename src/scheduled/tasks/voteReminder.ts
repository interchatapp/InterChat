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

import db from '#src/utils/Db.js';
import Constants from '#src/utils/Constants.js';
import Logger from '#src/utils/Logger.js';
import { stripIndents } from 'common-tags';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { ClusterManager } from 'discord-hybrid-sharding';

/**
 * Scheduled task to send voting reminders to users who haven't voted recently
 * This task runs every 6 hours to remind active users to vote
 */
export default async (cluster: ClusterManager): Promise<void> => {
  try {
    // Find users who have voted in the past 13 hours
    const reminderCutoff = new Date(Date.now() - 13 * 60 * 60 * 1000); // 13 hours ago

    const usersToRemind = await db.user.findMany({
      where: {
        voteCount: { gt: 0 }, // Has voted before
        lastVoted: { lt: reminderCutoff }, // Have voted in the past 13 hours
      },
      select: {
        id: true,
        voteCount: true,
        lastVoted: true,
      },
      take: 50, // Limit to prevent spam
    });

    if (usersToRemind.length === 0) {
      Logger.debug('No users need voting reminders');
      return;
    }

    Logger.info(`Sending voting reminders to ${usersToRemind.length} users`);

    // Create reminder embed
    const reminderEmbed = new EmbedBuilder()
      .setTitle('🗳️ Voting Reminder')
      .setDescription(
        stripIndents`
          Hey there! It's been a while since you last voted for InterChat.

          By voting, you help us grow and improve the bot for everyone. Plus, you get some cool perks for voting and climb the voting leaderboard!

          You can vote every 12 hours - don't miss out on your perks!
        `,
      )
      .setColor(Constants.Colors.primary)
      .setFooter({
        text: 'InterChat - Voting Reminder',
      });

    const reminderButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Vote Now')
        .setEmoji('<:topggSparkles:1359021457132355778>')
        .setURL(Constants.Links.Vote),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Voting Leaderboard')
        .setEmoji('🏆')
        .setCustomId('voting:leaderboard'),
    );

    const sentCountArr = await cluster.broadcastEval(
      async (client, ctx) => {
        let sentCount = 0;

        for (const user of ctx.usersToRemind) {
          const discordUser = await client.users.fetch(user.id).catch(() => null);
          if (!discordUser) continue;

          await discordUser
            .send({
              embeds: [ctx.reminderEmbed],
              components: [ctx.reminderButton],
            })
            .catch(() => null); // Ignore DM failures
          sentCount++;
          if (sentCount < usersToRemind.length) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        return sentCount;
      },
      {
        context: {
          usersToRemind,
          reminderEmbed: reminderEmbed.toJSON(),
          reminderButton: reminderButton.toJSON(),
        },
        shard: 0,
      },
    );

    Logger.info(`Successfully sent ${sentCountArr[0]} voting reminders`);
  }
  catch (error) {
    Logger.error('Error sending voting reminders:', error);
  }
};
