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

/**
 * Set metadata for a command based on directory structure
 */
const setCommandMetadata = (
  command: BaseCommand,
  dirName: string | undefined,
  category: string | undefined,
  depth: number,
) => {
  if (dirName) {
    command
      .setCategoryPath(dirName)
      .setCategory(category || '')
      .setIsSubcommand(depth > 1);
  }
};

/**
 * Process subcommands and set their metadata
 */
const processSubcommands = (
  command: BaseCommand,
  category: string | undefined,
  dirName: string | undefined,
) => {
  if (!command.subcommands) return;

  for (const [, subCmd] of Object.entries(command.subcommands)) {
    if (subCmd instanceof BaseCommand) {
      // Use setter methods for subcommands
      subCmd
        .setCategory(category || '')
        .setCategoryPath(dirName || '')
        .setIsSubcommand(true);
    }
    else {
      // Handle nested subcommands
      for (const [, nestedCmd] of Object.entries(subCmd)) {
        // Use setter methods for nested subcommands
        nestedCmd
          .setCategory(category || '')
          .setCategoryPath(dirName || '')
          .setIsSubcommand(true);
      }
    }
  }
};

/**
 * Register command and its aliases in the map
 */
const registerCommand = (
  command: BaseCommand,
  map: Collection<string, BaseCommand>,
  depth: number,
  file: string,
  aliasMap?: Collection<string, string>,
) => {
  if (depth <= 1 || (depth > 1 && file === 'index.js')) {
    map.set(command.name, command);

    // Register aliases in the alias map if provided
    if (command.aliases && aliasMap) {
      for (const alias of command.aliases) {
        aliasMap.set(alias, command.name);
      }
    }
  }
};

/**
 * Process a single command file
 */
const processCommandFile = async (
  file: string,
  path: string,
  map: Collection<string, BaseCommand>,
  interactionMap: Collection<string, InteractionFunction> | undefined,
  depth: number,
  dirName: string | undefined,
  category: string | undefined,
  aliasMap?: Collection<string, string>,
) => {
  const { default: Command } = await import(`${path}/${file}`);
  if (Command.prototype instanceof BaseCommand && !Command.abstract) {
    const command: BaseCommand = new Command();

    setCommandMetadata(command, dirName, category, depth);
    registerCommand(command, map, depth, file, aliasMap);
    processSubcommands(command, category, dirName);

    if (interactionMap) loadInteractionsForCommand(command, interactionMap);
  }
};

export const loadCommands = async (
  map: Collection<string, BaseCommand>,
  interactionMap?: Collection<string, InteractionFunction>,
  depth = 0,
  dirName?: string,
  aliasMap?: Collection<string, string>,
) => {
  const path = join(__dirname, '..', `commands${dirName ? `/${dirName}` : ''}`);
  const files = await readdir(join(path));

  // Extract category from dirName (top-level folder)
  const category = dirName?.split('/')[0];

  for (const file of files) {
    if (file.endsWith('.js')) {
      await processCommandFile(file, path, map, interactionMap, depth, dirName, category, aliasMap);
    }

    const stats = await stat(join(path, file));
    if (stats.isDirectory()) {
      // Recursively load commands from subdirectories
      await loadCommands(
        map,
        interactionMap,
        depth + 1,
        dirName ? join(dirName, file) : file,
        aliasMap,
      );
    }
  }
};
