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

import { CustomID } from '#src/utils/CustomID.js';
import Logger from '#src/utils/Logger.js';
import { sendErrorEmbed } from '#src/utils/Utils.js';
import {
  type ContextMenuCommandInteraction,
  type Interaction,
  InteractionType,
  Message,
} from 'discord.js';

type Repliable = Message | Interaction | ContextMenuCommandInteraction;

export interface ErrorHandlerOptions {
  repliable?: Repliable;
  comment?: string;
}

interface UserInfo {
  id: string;
  username: string;
}

function extractUserInfo(repliable: Repliable): UserInfo {
  if (repliable instanceof Message) {
    return { id: repliable.author.id, username: repliable.author.username };
  }

  return { id: repliable.user.id, username: repliable.user.username };
}

function extractCommandInfo(
  interaction: Interaction | ContextMenuCommandInteraction,
): string | undefined {
  if (!interaction.isCommand() && !interaction.isAutocomplete()) {
    return undefined;
  }

  if (interaction.isChatInputCommand()) {
    const subcommand = interaction.options.getSubcommand(false) ?? '';
    const subcommandGroup = interaction.options.getSubcommandGroup(false) ?? '';
    return `${interaction.commandName} ${subcommandGroup} ${subcommand}`.trim();
  }

  return interaction.commandName;
}

export function createErrorHint(repliable?: Repliable, comment?: string) {
  if (!repliable) {
    return undefined;
  }

  const extra = new Map<string, unknown>();
  const user = extractUserInfo(repliable);

  if (repliable instanceof Message) {
    if (comment) {
      extra.set('comment', comment);
    }
    return { user };
  }

  extra.set('type', InteractionType[repliable.type]);
  extra.set('commandName', extractCommandInfo(repliable));

  if ('customId' in repliable) {
    extra.set('customId', CustomID.parseCustomId(repliable.customId));
  }

  return { user: extractUserInfo(repliable), extra: Object.fromEntries(extra) };
}

export async function sendErrorResponse(
  repliable: Repliable,
  errorCode: string,
  comment?: string,
): Promise<void> {
  if (!('reply' in repliable)) return;

  try {
    await sendErrorEmbed(repliable, errorCode, comment);
  }
  catch (error) {
    Logger.error(error);
  }
}
