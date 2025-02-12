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

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Awaitable,
  ChatInputCommandInteraction,
  Collection,
  ContextMenuCommandInteraction,
} from 'discord.js';
import type { InteractionFunction } from '#src/decorators/RegisterInteractionHandler.js';
import Logger from '#utils/Logger.js';
import 'reflect-metadata';

export type CmdInteraction = ChatInputCommandInteraction | ContextMenuCommandInteraction;
export type Class<T extends object = { constructor: object }> = new (...args: unknown[]) => T;
export interface ResourceLoader {
  load(): Promise<void>;
}

const importPrefix = process.platform === 'win32' ? 'file://' : '';

export function getMetadata(target: { constructor: object }): {
  customId: string;
  methodName: string;
}[] {
  return Reflect.getMetadata('interactions', target.constructor) || [];
}

export function loadMetadata(
  target: { constructor: object },
  map: Collection<string, InteractionFunction>,
): void {
  const metadata = getMetadata(target);

  for (const { customId, methodName } of metadata) {
    Logger.debug(`Adding interaction: ${customId} with method ${methodName}`);
    // @ts-expect-error The names of child class properties can be custom
    const method: InteractionFunction = target[methodName];
    if (method) map.set(customId, method.bind(target));
  }
}


export class FileLoader {
  private readonly baseDir: string;
  private readonly recursive: boolean;

  constructor(baseDir: string, opts?: { recursive: boolean }) {
    this.baseDir = baseDir;
    this.recursive = opts?.recursive ?? false;
  }

  async loadFiles(processor: (filePath: string) => Awaitable<void>): Promise<void> {
    await this.processDirectory(this.baseDir, processor);
  }

  private async processDirectory(
    dir: string,
    processor: (filePath: string) => Awaitable<void>,
  ): Promise<void> {
    Logger.debug(`Processing directory: ${dir}`);
    const files = await readdir(dir);
    for (const file of files) {
      const filePath = join(dir, file);
      const stats = await stat(filePath);
      if (stats.isDirectory() && this.recursive) {
        await this.processDirectory(filePath, processor);
      }
      else if (file.endsWith('.js')) {
        await processor(filePath);
      }
    }
  }

  static async import<T>(filePath: string): Promise<T> {
    return await import(importPrefix + filePath);
  }
}
