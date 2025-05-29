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
import { type ModAction, replyWithUnknownMessage } from '#src/utils/moderation/modPanel/utils.js';
import { getOriginalMessage } from '#src/utils/network/messageUtils.js';
import { checkIfStaff } from '#src/utils/Utils.js';

import type { supportedLocaleCodes } from '#utils/Locale.js';
import type { Snowflake } from 'discord.js';

export default class ServerBanHandler implements ModAction {
  async handle(
    ctx: ComponentContext,
    originalMsgId: Snowflake,
    locale: supportedLocaleCodes,
  ) {
    const originalMsg = await getOriginalMessage(originalMsgId);

    if (!originalMsg) {
      await replyWithUnknownMessage(ctx, { locale });
      return;
    }

    if (!checkIfStaff(ctx.user.id)) {
      await ctx.reply({
        content: 'You do not have permission to ban servers.',
        flags: ['Ephemeral'],
      });
      return;
    }

    // Import and use the ban flow handler directly
    const { default: ModPanelBanFlowHandler } = await import('#src/interactions/ModPanelBanFlow.js');
    const banFlowHandler = new ModPanelBanFlowHandler();

    // Call the ban type selection directly
    await banFlowHandler.showBanTypeSelection(ctx, originalMsg.guildId, originalMsgId, 'server');
  }
}
