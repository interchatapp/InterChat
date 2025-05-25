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

import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { ActiveCallData, CallService } from '#src/services/CallService.js';
import Constants, { RedisKeys } from '#src/utils/Constants.js';
import { CustomID } from '#src/utils/CustomID.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Logger from '#src/utils/Logger.js';
import { getRedis } from '#src/utils/Redis.js';
import {
  getReasonFromKey,
  getReportReasons,
  type ReportReason,
} from '#src/utils/report/ReportReasons.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { supportedLocaleCodes, t } from '#utils/Locale.js';
import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';

export const buildReportCallReasonDropdown = (callId: string, locale: supportedLocaleCodes) =>
  new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(new CustomID('report_call:reason', [callId]).toString())
      .setPlaceholder(t('report.dropdown.placeholder', locale))
      .addOptions(getReportReasons(locale)),
  );

export default class ReportCallHandler {
  @RegisterInteractionHandler('report_call')
  async execute(ctx: ComponentContext) {
    const [callId] = ctx.customId.args;

    if (!callId) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Invalid report button. Please try again.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const locale = await fetchUserLocale(ctx.user.id);
    const selectMenu = buildReportCallReasonDropdown(callId, locale);

    await ctx.reply({
      content: `${getEmoji('info_icon', ctx.client)} Please select a reason for your report:`,
      components: [selectMenu],
      flags: ['Ephemeral'],
    });
  }

  @RegisterInteractionHandler('report_call', 'reason')
  async handleReportReasonSelect(ctx: ComponentContext) {
    await ctx.deferUpdate();

    // Check both type guards separately
    if (!ctx.isStringSelectMenu()) return;

    const [callId] = ctx.customId.args;
    const locale = await fetchUserLocale(ctx.user.id);

    if (!callId) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Invalid report. Please try again.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const callService = new CallService(ctx.client);
    const callData = await callService.getEndedCallData(callId);

    if (!callData) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Unable to find call data. The call might have ended too long ago.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Find the other channel's participants (the ones being reported)
    const otherChannelParticipants = callData.participants.find(
      (p) => p.channelId !== ctx.channelId,
    );

    if (!otherChannelParticipants || otherChannelParticipants.users.size === 0) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Unable to find participants from the other channel.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Get the selected reason from the dropdown
    if (!ctx.values || ctx.values.length === 0) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} No reason selected. Please try again.`,
        flags: ['Ephemeral'],
      });
      return;
    }
    const selectedReason = ctx.values[0] as ReportReason;

    // Get the translated reason
    const reason = getReasonFromKey(selectedReason, locale);

    // Get all users from the other channel to report
    const reportedUsers = Array.from(otherChannelParticipants.users);

    // Submit the report
    await this.submitReport({
      ctx,
      callId,
      serverId: otherChannelParticipants.guildId,
      reason,
      reportedUsers,
    });

    const successEmbed = new InfoEmbed().setDescription(
      t('msgInfo.report.success', locale, { emoji: getEmoji('tick_icon', ctx.client) }),
    );

    await ctx.editReply({ components: [], embeds: [successEmbed] });
  }

  private async submitReport(opts: {
    ctx: ComponentContext;
    callId: string;
    serverId: string;
    reason: string;
    reportedUsers: string[];
  }) {
    if (!opts.ctx.inGuild()) return false;

    const { ctx, callId, serverId, reason, reportedUsers } = opts;
    const redis = getRedis();
    const REPORTS_CHANNEL_ID = Constants.Channels.reports;

    try {
      // Get call data to calculate duration
      const callService = new CallService(ctx.client);
      const callData = await callService.getEndedCallData(callId);

      if (!callData) {
        Logger.error(`Failed to get call data for report: ${callId}`);
        return false;
      }

      // Calculate call duration if timestamps are available
      let callDuration = 0;
      if (callData.startTime && callData.endTime) {
        callDuration = callData.endTime - callData.startTime;
      }

      // Store report data in Redis
      const reportData = {
        callId,
        reporterId: ctx.user.id,
        reporterTag: ctx.user.tag,
        reporterChannelId: ctx.channelId,
        reporterGuildId: ctx.guildId,
        serverId,
        reason,
        reportedUsers,
        timestamp: Date.now(),
        status: 'pending',
        callDuration,
      };

      // Store report data with 30-day expiry
      const reportKey = `${RedisKeys.Call}:report:${callId}`;
      await redis.set(reportKey, JSON.stringify(reportData), 'EX', 30 * 24 * 60 * 60);

      // Store reporter ID for notification when report is resolved
      const reporterKey = `${RedisKeys.ReportReporter}:${callId}`;
      await redis.set(reporterKey, ctx.user.id, 'EX', 30 * 24 * 60 * 60);

      // Create the embed for the reports channel
      const reportEmbed = new EmbedBuilder()
        .setTitle('Call Report')
        .setColor('Red')
        .setDescription(
          `A call has been reported by ${ctx.user.tag} (${ctx.user.id})\n\n**Reason:** ${reason}`,
        )
        .addFields([
          { name: 'Call ID', value: callId, inline: true },
          { name: 'Server ID', value: serverId, inline: true },
          {
            name: 'Reported Users',
            value: reportedUsers.length > 0 ? reportedUsers.join('\n') : 'No users identified',
            inline: false,
          },
          { name: 'Reporter Channel', value: ctx.channelId, inline: true },
          { name: 'Reporter Server', value: ctx.guildId || 'Unknown', inline: true },
          {
            name: 'Call Duration',
            value: callDuration ? this.formatDuration(callDuration) : 'Unknown',
            inline: true,
          },
        ])
        .setFooter({
          text: `Reported by: ${ctx.user.username} | Use \`/view_reported_call ${callId}\` to view details.`,
          iconURL: ctx.user.displayAvatarURL(),
        })
        .setTimestamp();

      // Send the report to the reports channel
      const reportsChannel = await ctx.client.channels
        .fetch(REPORTS_CHANNEL_ID)
        .catch(() => null);

      if (!reportsChannel || !reportsChannel.isSendable()) {
        Logger.error(
          `Failed to send report: Reports channel ${REPORTS_CHANNEL_ID} not found or not a text channel`,
        );
        return false;
      }

      await reportsChannel.send({ embeds: [reportEmbed] });

      // Store call messages for review (if any)
      await this.storeCallMessages(callId, callData);

      // Extend the expiry time of the call data to 48 hours for moderation purposes
      const callDataKey = `${RedisKeys.Call}:ended:${callId}`;
      await redis.expire(callDataKey, 172800); // 48 hours in seconds

      return true;
    }
    catch (error) {
      Logger.error('Error sending call report:', error);
      return false;
    }
  }

  /**
   * Store call messages for later review
   */
  private async storeCallMessages(callId: string, callData: ActiveCallData) {
    try {
      const redis = getRedis();
      const messagesKey = `${RedisKeys.Call}:messages:${callId}`;

      // Check if we already have messages stored
      const existingMessages = await redis.llen(messagesKey);
      if (existingMessages > 0) {
        // Messages already stored, no need to store again
        return;
      }

      // Get messages from call data if available
      const messages = callData.messages || [];

      if (messages.length > 0) {
        // Store each message in Redis list
        const pipeline = redis.pipeline();

        for (const message of messages) {
          pipeline.rpush(messagesKey, JSON.stringify(message));
        }

        // Set 30-day expiry
        pipeline.expire(messagesKey, 30 * 24 * 60 * 60);

        await pipeline.exec();
        Logger.debug(`Stored ${messages.length} messages for call ${callId}`);
      }
      else {
        Logger.debug(`No messages found for call ${callId}`);
      }
    }
    catch (error) {
      Logger.error(`Error storing call messages for ${callId}:`, error);
    }
  }

  /**
   * Format call duration in a human-readable format
   */
  private formatDuration(durationMs: number): string {
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes === 0) {
      return `${seconds} seconds`;
    }

    return `${minutes} min ${remainingSeconds} sec`;
  }
}
