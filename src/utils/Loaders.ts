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

import BaseCommand from '#src/core/BaseCommand.js';
import { loadMetadata } from '#src/core/FileLoader.js';
import type { InteractionFunction } from '#src/decorators/RegisterInteractionHandler.js';
import type { Collection } from 'discord.js';
import isEmpty from 'lodash/isEmpty.js';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const __dirname = new URL('.', import.meta.url).pathname;

export const loadInteractionsForCommand = (
  command: BaseCommand,
  interactionMap: Collection<string, InteractionFunction>,
) => {
  if (!isEmpty(command.subcommands)) {
    for (const subcommand of Object.values(command.subcommands)) {
      loadMetadata(subcommand, interactionMap);
    }
  }

  loadMetadata(command, interactionMap);
};

export const loadCommands = async (
  map: Collection<string, BaseCommand>,
  interactionMap?: Collection<string, InteractionFunction>,
  depth = 0,
  dirName?: string,
) => {
  const path = join(__dirname, '..', `commands${dirName ? `/${dirName}` : ''}`);
  const files = await readdir(join(path));

  for (const file of files) {
    if (file.endsWith('.js')) {
      const { default: Command } = await import(`${path}/${file}`);
      if (Command.prototype instanceof BaseCommand && !Command.abstract) {
        const command: BaseCommand = new Command();
        if (depth <= 1 || (depth > 1 && file === 'index.js')) {
          map.set(command.name, command);
        }

        if (interactionMap) loadInteractionsForCommand(command, interactionMap);
      }
    }

    const stats = await stat(join(path, file));
    if (stats.isDirectory()) {
      // Recursively load commands from subdirectories
      await loadCommands(
        map,
        interactionMap,
        depth + 1,
        dirName ? join(dirName, file) : file,
      );
    }
  }
};
