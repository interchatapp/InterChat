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

import type { Awaitable, Client, ClientEvents } from 'discord.js';
import { type EmojiKeys, getEmoji } from '#src/utils/EmojiUtils.js';

export type EventParams = {
  [K in keyof ClientEvents]: ClientEvents[K];
};

export default abstract class BaseEventListener<K extends keyof ClientEvents> {
  abstract name: K;

  protected readonly client: Client | null;

  constructor(client: Client | null) {
    this.client = client;
  }

  protected getEmoji(name: EmojiKeys): string {
    if (!this.client?.isReady()) return '';
    return getEmoji(name, this.client);
  }

  abstract execute(...args: EventParams[K]): Awaitable<void>;
}
