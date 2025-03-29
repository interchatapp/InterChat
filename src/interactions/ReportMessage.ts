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
import HubLogManager from '#src/managers/HubLogManager.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { sendHubReport } from '#src/utils/hub/logger/Report.js';
import { findOriginalMessage } from '#src/utils/network/messageUtils.js';
import {
  getReasonFromKey,
  getReportReasons,
  type ReportReason,
} from '#src/utils/report/ReportReasons.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { CustomID } from '#utils/CustomID.js';
import { supportedLocaleCodes, t } from '#utils/Locale.js';
import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';

export const buildReportReasonDropdown = (messageId: string, locale: supportedLocaleCodes) =>
  new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(new CustomID('report:reason', [messageId]).toString())
      .setPlaceholder(t('report.dropdown.placeholder', locale))
      .addOptions(getReportReasons(locale)),
  );

export default class ReportMessageHandler {
  @RegisterInteractionHandler('report', 'reason')
  async handleReportReasonSelect(interaction: StringSelectMenuInteraction) {
    await interaction.deferUpdate();

    const customId = CustomID.parseCustomId(interaction.customId);
    const [messageId] = customId.args;
    const originalMsg = await findOriginalMessage(messageId);
    const locale = await fetchUserLocale(interaction.user.id);

    if (
      !originalMsg?.hubId ||
      !(await HubLogManager.create(originalMsg?.hubId)).config.reports?.channelId
    ) {
      const notEnabledEmbed = new InfoEmbed().setDescription(
        t('msgInfo.report.notEnabled', locale, { emoji: getEmoji('x_icon', interaction.client) }),
      );

      await interaction.followUp({ embeds: [notEnabledEmbed], flags: ['Ephemeral'] });
      return;
    }

    const { authorId, guildId, content } = originalMsg;

    // Get the selected reason from the dropdown
    const selectedReason = interaction.values[0] as ReportReason;

    // Get the translated reason
    const reason = getReasonFromKey(selectedReason, locale);

    await this.submitReport({
      interaction,
      hubId: originalMsg.hubId,
      messageId,
      authorId,
      guildId,
      reason,
      content,
    });
  }

  private async submitReport(opts: {
    interaction: StringSelectMenuInteraction;
    hubId: string;
    messageId: string;
    authorId: string;
    guildId: string;
    reason: string;
    content: string;
  }) {
    const { interaction, hubId, messageId, authorId, guildId, reason, content } = opts;
    const locale = await fetchUserLocale(interaction.user.id);

    const message = await interaction.channel?.messages.fetch(messageId).catch(() => null);
    const attachmentUrl =
      content?.match(/https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp)/i)?.at(0) ??
      message?.embeds[0]?.image?.url;

    await sendHubReport(hubId, interaction.client, {
      userId: authorId,
      serverId: guildId,
      reason,
      reportedBy: interaction.user,
      evidence: { content, attachmentUrl, messageId },
    });

    const successEmbed = new InfoEmbed().setDescription(
      t('msgInfo.report.success', locale, { emoji: getEmoji('tick_icon', interaction.client) }),
    );

    await interaction.editReply({ components: [], embeds: [successEmbed] });
  }
}
