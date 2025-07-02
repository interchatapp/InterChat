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
import InfractionManager from '#src/managers/InfractionManager.js';
import { PaginationManager } from '#src/utils/ui/PaginationManager.js';
import { type ModAction, replyWithUnknownMessage } from '#src/utils/moderation/modPanel/utils.js';
import { getOriginalMessage } from '#src/utils/network/messageUtils.js';
import type { supportedLocaleCodes } from '#utils/Locale.js';
import { buildInfractionListEmbeds } from '#utils/moderation/infractionUtils.js';
import { type Snowflake, ContainerBuilder, TextDisplayBuilder, EmbedBuilder, type APIEmbed } from 'discord.js';

export default class ViewInfractionsHandler implements ModAction {
  async handle(
    ctx: ComponentContext,
    originalMsgId: Snowflake,
    locale: supportedLocaleCodes,
  ) {
    await ctx.deferReply({ flags: ['Ephemeral'] });

    const originalMsg = await getOriginalMessage(originalMsgId);

    if (!originalMsg) {
      await replyWithUnknownMessage(ctx, { locale });
      return;
    }

    const user = await ctx.client.users.fetch(originalMsg.authorId).catch(() => null);
    if (!user) {
      await replyWithUnknownMessage(ctx, { locale });
      return;
    }

    const infractionManager = new InfractionManager('user', originalMsg.authorId);
    const infractions = await infractionManager.getHubInfractions(originalMsg.hubId);
    const targetName = user.username ?? 'Unknown User.';
    const iconURL = user.displayAvatarURL();

    const embeds = await buildInfractionListEmbeds(
      ctx.client,
      targetName,
      infractions,
      'user',
      iconURL,
    );

    if (embeds.length === 0) {
      await ctx.editReply({ content: 'No infractions found for this user.' });
      return;
    }

    if (embeds.length === 1) {
      // Single page, just reply directly
      await ctx.editReply(embeds[0]);
      return;
    }

    // Use PaginationManager for multiple pages
    const paginationManager = new PaginationManager({
      client: ctx.client,
      identifier: `mod-infractions-${originalMsg.authorId}`,
      items: embeds,
      itemsPerPage: 1,
      deleteOnEnd: true,
      ephemeral: true,
      contentGenerator: (pageIndex, itemsOnPage) => {
        const container = new ContainerBuilder();
        const page = itemsOnPage[0];

        if (page.embeds?.[0]) {
          const embed = page.embeds[0];

          // Convert embed to text content
          let content = '';

          // Handle EmbedBuilder vs APIEmbed
          if (embed instanceof EmbedBuilder) {
            if (embed.data.title) {
              content += `## ${embed.data.title}\n\n`;
            }

            if (embed.data.fields && embed.data.fields.length > 0) {
              content += embed.data.fields.map((field) =>
                `**${field.name}**\n${field.value}`,
              ).join('\n\n');
            }

            if (embed.data.footer?.text) {
              content += `\n\n*${embed.data.footer.text}*`;
            }
          }
          else {
            // Handle APIEmbed
            const apiEmbed = embed as APIEmbed;
            if (apiEmbed.title) {
              content += `## ${apiEmbed.title}\n\n`;
            }

            if (apiEmbed.fields && apiEmbed.fields.length > 0) {
              content += apiEmbed.fields.map((field) =>
                `**${field.name}**\n${field.value}`,
              ).join('\n\n');
            }

            if (apiEmbed.footer?.text) {
              content += `\n\n*${apiEmbed.footer.text}*`;
            }
          }

          const textDisplay = new TextDisplayBuilder().setContent(content);
          container.addTextDisplayComponents(textDisplay);
        }

        return container;
      },
    });

    await paginationManager.start(ctx);
  }
}
