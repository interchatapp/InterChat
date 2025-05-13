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

import { buildModPanel } from '#src/interactions/ModPanel.js';
import { HubService } from '#src/services/HubService.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { logMsgDelete } from '#src/utils/hub/logger/ModLogs.js';
import { type ModAction, replyWithUnknownMessage } from '#src/utils/moderation/modPanel/utils.js';
import { getBroadcasts, getOriginalMessage } from '#src/utils/network/messageUtils.js';

import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import { deleteMessageFromHub, isDeleteInProgress } from '#utils/moderation/deleteMessage.js';
import type { Snowflake } from 'discord.js';

export default class DeleteMessageHandler implements ModAction {
  async handle(ctx: ComponentContext, originalMsgId: Snowflake, locale: supportedLocaleCodes) {
    const originalMsg = await getOriginalMessage(originalMsgId);
    if (!originalMsg) {
      await replyWithUnknownMessage(ctx, { locale });
      return;
    }

    const deleteInProgress = await isDeleteInProgress(originalMsg.id);
    if (deleteInProgress) {
      const { embed, buttons } = await buildModPanel(ctx, originalMsg);
      await ctx.editReply({ embeds: [embed], components: buttons });

      const errorEmbed = new InfoEmbed().setDescription(
        `${getEmoji('neutral', ctx.client)} This message is already deleted or is being deleted by another moderator.`,
      );

      await ctx.reply({ flags: ['Ephemeral'], embeds: [errorEmbed] });
      return;
    }

    await ctx.reply({
      content: `${getEmoji('loading', ctx.client)} Deleting messages... This may take a minute or so.`,
      flags: ['Ephemeral'],
    });

    const broadcastMsgs = Object.values(await getBroadcasts(originalMsg.id));

    const { deletedCount } = await deleteMessageFromHub(
      originalMsg.hubId,
      originalMsg.id,
      broadcastMsgs,
    );

    await ctx
      .editReply(
        t('network.deleteSuccess', await fetchUserLocale(ctx.user.id), {
          emoji: getEmoji('tick_icon', ctx.client),
          user: `<@${originalMsg.authorId}>`,
          deleted: `${deletedCount}`,
          total: `${broadcastMsgs.length}`,
        }),
      )
      .catch(() => null);

    const hub = await new HubService().fetchHub(originalMsg.hubId);
    if (!hub) return;

    await logMsgDelete(ctx.client, originalMsg, await hub.fetchLogConfig(), {
      hubName: hub.data.name,
      modName: ctx.user.username,
    });
  }
}
