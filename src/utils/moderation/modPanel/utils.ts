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
import Context from '#src/core/CommandContext/Context.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import type { Message as MessageDB } from '#src/generated/prisma/client/client.js';
import { type supportedLocaleCodes } from '#utils/Locale.js';
import type { Snowflake } from 'discord.js';

export interface ModAction {
  handle(
    ctx: ComponentContext,
    originalMsgId: Snowflake,
    locale: supportedLocaleCodes,
  ): Promise<void>;
  handleModal?(
    ctx: ComponentContext,
    originalMsg: MessageDB,
    locale: supportedLocaleCodes,
  ): Promise<void>;
}

interface ReplyWithUnknownMessageOpts {
  locale?: supportedLocaleCodes;
  edit?: boolean;
}

export async function replyWithUnknownMessage(
  ctx: Context,
  opts: ReplyWithUnknownMessageOpts = {},
) {
  const { edit = false } = opts;

  const emoji = getEmoji('x_icon', ctx.client);
  await ctx.replyEmbed('errors.unknownNetworkMessage', {
    t: { emoji },
    flags: ['Ephemeral'],
    edit,
  });
}
