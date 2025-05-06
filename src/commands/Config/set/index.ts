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

import SetLanguage from '#src/commands/Config/set/language.js';
import ReplyMention from '#src/commands/Config/set/reply_mentions.js';
import BaseCommand from '#src/core/BaseCommand.js';

export default class SetCommand extends BaseCommand {
  constructor() {
    super({
      name: 'set',
      description: 'Set your preferences',
      types: {
        slash: true,
      },
      subcommands: {
        language: new SetLanguage(),
        reply_mentions: new ReplyMention(),
      },
    });
  }
}
