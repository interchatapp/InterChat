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
import { handleServerBan } from '#src/utils/BanUtils.js';

export default class ServerBanModalHandler {
  @RegisterInteractionHandler('serverBanModal')
  async handleModal(ctx: ComponentContext): Promise<void> {
    if (!ctx.isModalSubmit()) return;

    const [serverId] = ctx.customId.args;

    const server = await ctx.client.guilds.fetch(serverId).catch(() => null);
    const reason = ctx.getModalFieldValue('reason');

    await handleServerBan(ctx, serverId, server?.name || serverId, reason);
  }
}
