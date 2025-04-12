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

import type { UserData } from '#src/generated/prisma/client/client.js';
import type { Collection, HexColorString, Message, User } from 'discord.js';
import type { Broadcast, OriginalMessage } from '#src/utils/network/messageUtils.js';

export interface ReferredMsgData {
  dbReferrence: (OriginalMessage & { broadcastMsgs: Collection<string, Broadcast> }) | null;
  referredAuthor: User | null;
  dbReferredAuthor: UserData | null;
  referredMessage?: Message;
}

export interface BroadcastOpts {
  referredMsgData: ReferredMsgData;
  embedColor?: HexColorString;
  attachmentURL?: string | null;
}
