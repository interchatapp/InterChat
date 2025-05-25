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

import InterChatClient from '#src/core/BaseClient.js';
import { Report, ReportStatus } from '#src/generated/prisma/client/client.js';
import Logger from '#src/utils/Logger.js';
import { handleError } from '#src/utils/Utils.js';
import db from '#utils/Db.js';
import { stripIndents } from 'common-tags';
import { Colors, EmbedBuilder, type Client } from 'discord.js';

export class ReportService {
  /**
   * Automatically resolve a report when moderation action is taken
   */
  static async autoResolveReport(
    reportId: string,
    moderatorId: string,
    actionTaken: ReportStatus,
  ): Promise<void> {
    if (!reportId) return;

    try {
      const report = await db.report.findUnique({
        where: { id: reportId },
        include: { reporter: true },
      });

      if (!report || report.status !== ReportStatus.PENDING) return;

      // Update report status
      await db.report.update({
        where: { id: reportId },
        data: {
          status: ReportStatus.RESOLVED,
          handledBy: moderatorId,
          handledAt: new Date(),
        },
      });

      // Notify reporter about the action taken
      await this.notifyReporterOfAction(report, actionTaken);
    }
    catch (error) {
      Logger.error('Failed to auto-resolve report:', error);
    }
  }

  /**
   * Send DM notification to reporter about action taken
   */
  private static async notifyReporterOfAction(
    report: Report,
    actionTaken: ReportStatus,
  ): Promise<void> {
    try {
      if (!report.reporterId) return;

      const client = InterChatClient.instance;

      // Try to send DM to reporter
      const reporterUser = await db.user.findUnique({
        where: { id: report.reporterId },
      });

      if (reporterUser && client) {
        await this.sendReporterNotification(client, report.id, actionTaken);
      }
    }
    catch (error) {
      Logger.error('Failed to notify reporter of action:', error);
    }
  }

  /**
   * Get report by ID
   */
  static async getReport(reportId: string) {
    return await db.report.findUnique({
      where: { id: reportId },
      include: {
        reporter: true,
        reportedUser: true,
        handler: true,
        hub: true,
      },
    });
  }

  /**
   * Get pending reports for a hub
   */
  static async getPendingReports(hubId: string) {
    return await db.report.findMany({
      where: {
        hubId,
        status: ReportStatus.PENDING,
      },
      include: {
        reporter: true,
        reportedUser: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Get report statistics for a hub
   */
  static async getReportStats(hubId: string) {
    const [total, pending, resolved, ignored] = await Promise.all([
      db.report.count({ where: { hubId } }),
      db.report.count({ where: { hubId, status: ReportStatus.PENDING } }),
      db.report.count({ where: { hubId, status: ReportStatus.RESOLVED } }),
      db.report.count({ where: { hubId, status: ReportStatus.IGNORED } }),
    ]);

    return {
      total,
      pending,
      resolved,
      ignored,
    };
  }

  /**
   * Send DM notification to reporter (requires client instance)
   */
  static async sendReporterNotification(
    client: Client,
    reportId: string,
    status: ReportStatus,
  ): Promise<void> {
    try {
      const report = await db.report.findUnique({
        where: { id: reportId },
        include: { reporter: true },
      });

      if (!report) return;

      const statusEmoji = {
        [ReportStatus.RESOLVED]: '✅',
        [ReportStatus.IGNORED]: '🔇',
        [ReportStatus.PENDING]: '⏳',
      };

      const statusText = {
        [ReportStatus.RESOLVED]: 'resolved with action taken',
        [ReportStatus.IGNORED]: 'reviewed and closed',
        [ReportStatus.PENDING]: 'pending review',
      };

      const embed = new EmbedBuilder()
        .setTitle(`${statusEmoji[status]} Report Update`)
        .setDescription(
          stripIndents`
            Your report **${reportId}** has been **${statusText[status]}** by a moderator.
            
            **Original reason:** ${report.reason}
            **Status:** ${statusText[status]}
            
            Thank you for helping keep our community safe!
          `,
        )
        .setColor(status === ReportStatus.RESOLVED ? Colors.Green : Colors.Grey)
        .setTimestamp();

      const discordUser = await client.users.fetch(report.reporterId).catch(() => null);
      await discordUser?.send({ embeds: [embed] }).catch(() => {
        // User has DMs disabled or bot is blocked - this is expected
      });
    }
    catch (error) {
      handleError(error, { comment: 'Failed to send reporter notification' });
    }
  }
}
