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

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Client, type ClientEvents, Collection } from 'discord.js';
import type InterChatClient from '#src/core/BaseClient.js';
import type BaseEventListener from '#src/core/BaseEventListener.js';
import { FileLoader } from '#src/core/FileLoader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default class EventLoader {
  private readonly listeners: Map<string, BaseEventListener<keyof ClientEvents>> = new Collection();
  private readonly client: Client;
  private readonly fileLoader: FileLoader;
  public readonly folderPath = join(__dirname, '..', '..', 'events');

  constructor(client: InterChatClient) {
    this.client = client;
    this.fileLoader = new FileLoader(this.folderPath);
  }

  /** Loads all event listeners from the `events` directory. */
  public async load(): Promise<void> {
    await this.fileLoader.loadFiles(this.registerListener.bind(this));
  }

  private async registerListener(filePath: string) {
    const { default: Listener } = await FileLoader.import<{
      default: new (client: Client) => BaseEventListener<keyof ClientEvents>;
    }>(filePath);

    const listener = new Listener(this.client);
    this.listeners.set(listener.name, listener);
    this.client.on(listener.name, listener.execute.bind(listener));
  }
}
