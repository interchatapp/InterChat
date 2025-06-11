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
import HubLogManager from '#src/managers/HubLogManager.js';
import { HubService } from '#src/services/HubService.js';
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
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
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
  async handleReportReasonSelect(ctx: ComponentContext) {
    await ctx.deferUpdate();

    if (!ctx.isStringSelectMenu()) return;

    const [messageId] = ctx.customId.args;
    const originalMsg = await findOriginalMessage(messageId);
    const locale = await fetchUserLocale(ctx.user.id);

    if (
      !originalMsg?.hubId ||
      !(await HubLogManager.create(originalMsg?.hubId)).config.reportsChannelId
    ) {
      const notEnabledEmbed = new InfoEmbed().setDescription(
        t('msgInfo.report.notEnabled', locale, { emoji: getEmoji('x_icon', ctx.client) }),
      );

      await ctx.reply({ embeds: [notEnabledEmbed], flags: ['Ephemeral'] });
      return;
    }

    const { authorId, guildId, content } = originalMsg;

    // Get the selected reason from the dropdown
    const selectedReason = ctx.values?.[0] as ReportReason | undefined;
    if (!selectedReason) {
      await ctx.reply({
        content: t('report.errors.noReasonSelected', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    // Get the translated reason
    const reason = getReasonFromKey(selectedReason, locale);
    const hub = await new HubService().fetchHub(originalMsg.hubId);
    if (!hub) {
      await ctx.reply({
        content: t('report.errors.hubNotFound', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    await this.submitReport({
      ctx,
      hubId: originalMsg.hubId,
      hubName: hub.data.name,
      messageId,
      authorId,
      guildId,
      reason,
      content,
    });
  }

  private async submitReport(opts: {
    ctx: ComponentContext;
    hubId: string;
    hubName: string;
    messageId: string;
    authorId: string;
    guildId: string;
    reason: string;
    content: string;
  }) {
    const { ctx, hubId, hubName, messageId, authorId, guildId, reason } = opts;
    const locale = await fetchUserLocale(ctx.user.id);

    await sendHubReport(hubId, hubName, ctx.client, {
      userId: authorId,
      serverId: guildId,
      reason,
      reportedBy: ctx.user,
      messageId,
    });

    const successEmbed = new InfoEmbed().setDescription(
      t('msgInfo.report.success', locale, { emoji: getEmoji('tick_icon', ctx.client) }),
    );

    await ctx.editReply({ components: [], embeds: [successEmbed] });
  }
}
