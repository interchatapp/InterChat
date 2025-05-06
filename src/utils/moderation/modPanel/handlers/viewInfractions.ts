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
import { Pagination } from '#src/modules/Pagination.js';
import { type ModAction, replyWithUnknownMessage } from '#src/utils/moderation/modPanel/utils.js';
import { getOriginalMessage } from '#src/utils/network/messageUtils.js';
import type { supportedLocaleCodes } from '#utils/Locale.js';
import { buildInfractionListEmbeds } from '#utils/moderation/infractionUtils.js';
import type { Snowflake } from 'discord.js';

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

    new Pagination(ctx.client).addPages(embeds).run(ctx, { deleteOnEnd: true });
  }
}
