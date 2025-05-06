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

import { stripIndents } from 'common-tags';
import {
  type APIEmbed,
  type Client,
  Colors,
  EmbedBuilder,
  type EmbedData,
  codeBlock,
  resolveColor,
} from 'discord.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import Constants from '#utils/Constants.js';

export class InfoEmbed extends EmbedBuilder {
  constructor(data?: EmbedData | APIEmbed) {
    super({
      color: resolveColor(Constants.Colors.primary),
      ...data,
    });
  }

  removeTitle(): this {
    super.setTitle(null);
    return this;
  }

  setTitle(title?: string | null): this {
    if (title) super.setTitle(title);
    return this;
  }
}

export class ErrorEmbed extends EmbedBuilder {
  private errorCode: string | null = null;
  constructor(client: Client, data?: { errorCode?: string }) {
    super({
      title: `${getEmoji('x_icon', client)} Unexpected Error Occurred`,
      color: Colors.Red,
      footer: { text: 'You will earn bug points for every bug you report!' },
    });

    if (data?.errorCode) this.setErrorCode(data.errorCode);
  }

  setErrorCode(errorCode: string | null): this {
    this.errorCode = errorCode;

    if (!errorCode) return this;

    return super.setDescription(stripIndents`
      ${this.data.description ?? ''}

      Please join our [support server](https://discord.gg/interchat) and report the following error code:
      ${codeBlock(errorCode)}
    `);
  }

  setDescription(description: string): this {
    super.setDescription(description);
    if (this.errorCode) this.setErrorCode(this.errorCode);

    return this;
  }
}
