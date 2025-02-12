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

import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  RepliableInteraction,
  Snowflake,
} from 'discord.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { getReplyMethod } from '#src/utils/Utils.js';
import type { OriginalMessage } from '#src/utils/network/messageUtils.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import Context from '#src/core/CommandContext/Context.js';

export interface ModAction {
  handle(
    interaction: ButtonInteraction,
    originalMsgId: Snowflake,
    locale: supportedLocaleCodes,
  ): Promise<void>;
  handleModal?(
    interaction: ModalSubmitInteraction,
    originalMsg: OriginalMessage,
    locale: supportedLocaleCodes,
  ): Promise<void>;
}

interface ReplyWithUnknownMessageOpts {
  locale?: supportedLocaleCodes;
  edit?: boolean;
}

export async function replyWithUnknownMessage<T extends Context>(
  interaction: T,
  opts?: ReplyWithUnknownMessageOpts,
): Promise<void>;
export async function replyWithUnknownMessage<T extends RepliableInteraction>(
  interaction: T,
  opts: ReplyWithUnknownMessageOpts & { locale: supportedLocaleCodes },
): Promise<void>;
export async function replyWithUnknownMessage<T extends Context | RepliableInteraction>(
  interaction: T,
  opts: ReplyWithUnknownMessageOpts = {},
) {
  const { locale, edit = false } = opts;

  const emoji = getEmoji('x_icon', interaction.client);
  if (interaction instanceof Context) {
    await interaction.replyEmbed('errors.unknownNetworkMessage', {
      t: { emoji },
      flags: ['Ephemeral'],
      edit,
    });
  }
  else {
    if (!locale) {
      throw new Error('locale is required when interaction is not a Context');
    }

    const embed = new InfoEmbed().setDescription(
      t('errors.unknownNetworkMessage', locale, { emoji }),
    );

    if (edit) await interaction.editReply({ embeds: [embed], components: [] });

    const replyMethod = getReplyMethod(interaction);
    await interaction[replyMethod]({ embeds: [embed], flags: ['Ephemeral'] });
  }
}
