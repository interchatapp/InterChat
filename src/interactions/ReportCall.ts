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

import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { CallService } from '#src/services/CallService.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { getReasonFromKey, getReportReasons, type ReportReason } from '#src/utils/report/ReportReasons.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { CustomID } from '#src/utils/CustomID.js';
import { supportedLocaleCodes, t } from '#utils/Locale.js';
import {
  ActionRowBuilder,
  ButtonInteraction,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';
import Logger from '#src/utils/Logger.js';
import Constants from '#src/utils/Constants.js';

export const buildReportCallReasonDropdown = (callId: string, locale: supportedLocaleCodes) =>
  new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(new CustomID('report_call:reason', [callId]).toString())
      .setPlaceholder(t('report.dropdown.placeholder', locale))
      .addOptions(getReportReasons(locale)),
  );

export default class ReportCallHandler {
  @RegisterInteractionHandler('report_call')
  async execute(interaction: ButtonInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [callId] = customId.args;

    if (!callId) {
      await interaction.reply({
        content: `${getEmoji('x_icon', interaction.client)} Invalid report button. Please try again.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const locale = await fetchUserLocale(interaction.user.id);
    const selectMenu = buildReportCallReasonDropdown(callId, locale);

    await interaction.reply({
      content: `${getEmoji('info_icon', interaction.client)} Please select a reason for your report:`,
      components: [selectMenu],
      flags: ['Ephemeral'],
    });
  }

  @RegisterInteractionHandler('report_call', 'reason')
  async handleReportReasonSelect(interaction: StringSelectMenuInteraction) {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [callId] = customId.args;
    const locale = await fetchUserLocale(interaction.user.id);

    if (!callId) {
      await interaction.followUp({
        content: `${getEmoji('x_icon', interaction.client)} Invalid report. Please try again.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const callService = new CallService(interaction.client);
    const callData = await callService.getEndedCallData(callId);

    if (!callData) {
      await interaction.followUp({
        content: `${getEmoji('x_icon', interaction.client)} Unable to find call data. The call might have ended too long ago.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Find the other channel's participants (the ones being reported)
    const otherChannelParticipants = callData.participants.find(
      (p) => p.channelId !== interaction.channelId,
    );

    if (!otherChannelParticipants || otherChannelParticipants.users.size === 0) {
      await interaction.followUp({
        content: `${getEmoji('x_icon', interaction.client)} Unable to find participants from the other channel.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    // Get the selected reason from the dropdown
    const selectedReason = interaction.values[0] as ReportReason;

    // Get the translated reason
    const reason = getReasonFromKey(selectedReason, locale);

    // Get all users from the other channel to report
    const reportedUsers = Array.from(otherChannelParticipants.users);

    // Submit the report
    await this.submitReport({
      interaction,
      callId,
      serverId: otherChannelParticipants.guildId,
      reason,
      reportedUsers,
    });

    const successEmbed = new InfoEmbed().setDescription(
      t('msgInfo.report.success', locale, { emoji: getEmoji('tick_icon', interaction.client) }),
    );

    await interaction.editReply({ components: [], embeds: [successEmbed] });
  }

  private async submitReport(opts: {
    interaction: StringSelectMenuInteraction;
    callId: string;
    serverId: string;
    reason: string;
    reportedUsers: string[];
  }) {
    const { interaction, callId, serverId, reason, reportedUsers } = opts;
    const REPORTS_CHANNEL_ID = Constants.Channels.reports;

    try {
      const reportEmbed = new EmbedBuilder()
        .setTitle('Call Report')
        .setColor('Red')
        .setDescription(`A call has been reported by ${interaction.user.tag} (${interaction.user.id})\n\n**Reason:** ${reason}`)
        .addFields([
          { name: 'Call ID', value: callId, inline: true },
          { name: 'Server ID', value: serverId, inline: true },
          { name: 'Reported Users', value: reportedUsers.length > 0 ? reportedUsers.join('\n') : 'No users identified', inline: false },
          { name: 'Reporter Channel', value: interaction.channelId, inline: true },
          { name: 'Reporter Server', value: interaction.guildId || 'Unknown', inline: true },
        ])
        .setFooter({
          text: `Reported by: ${interaction.user.username} | Use \`/view_call\` to view the call details.`,
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      // Send the report to the reports channel
      const reportsChannel = await interaction.client.channels.fetch(REPORTS_CHANNEL_ID)
        .catch(() => null);

      if (!reportsChannel || !reportsChannel.isSendable()) {
        Logger.error(`Failed to send report: Reports channel ${REPORTS_CHANNEL_ID} not found or not a text channel`);
        return false;
      }

      await reportsChannel.send({ embeds: [reportEmbed] });
      return true;
    }
    catch (error) {
      Logger.error('Error sending call report:', error);
      return false;
    }
  }
}
