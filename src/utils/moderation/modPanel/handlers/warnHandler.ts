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
import { HubService } from '#src/services/HubService.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { t } from '#src/utils/Locale.js';
import type { ModAction } from '#src/utils/moderation/modPanel/utils.js';
import { getOriginalMessage } from '#src/utils/network/messageUtils.js';
import { CustomID } from '#utils/CustomID.js';
import type { supportedLocaleCodes } from '#utils/Locale.js';
import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export default class WarnHandler implements ModAction {
  private readonly hubService = new HubService();
  async handle(
    ctx: ComponentContext,
    originalMsgId: string,
    locale: supportedLocaleCodes,
  ): Promise<void> {
    const originalMsg = await getOriginalMessage(originalMsgId);

    if (!originalMsg) {
      const errorEmbed = new InfoEmbed().setDescription(
        t('errors.messageNotSentOrExpired', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
      );
      await ctx.reply({ embeds: [errorEmbed], flags: ['Ephemeral'] });
      return;
    }

    const hub = await this.hubService.fetchHub(originalMsg.hubId);
    if (!hub) return;

    const modal = new ModalBuilder()
      .setTitle(t('warn.modal.title', locale))
      .setCustomId(
        new CustomID()
          .setIdentifier('warnModal')
          .setArgs(originalMsg.authorId, originalMsg.hubId)
          .toString(),
      )
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel(t('warn.modal.reason.label', locale))
            .setPlaceholder(t('warn.modal.reason.placeholder', locale))
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500),
        ),
      );

    await ctx.showModal(modal);
    // modal will be handled by WarnModalHandler in interactions/WarnModal.ts
  }
}
