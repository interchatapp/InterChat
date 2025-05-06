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

import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { fetchConnection, updateConnection } from '#utils/ConnectedListUtils.js';
import { CustomID } from '#utils/CustomID.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { t } from '#utils/Locale.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

type extraOpts = {
  disconnectEmoji?: string;
  connectEmoji?: string;
  userId?: string;
  /** set custom prefix for customId and handle it urself, eg: `epik_reconnect`  */
  customCustomId?: string;
};

/**
 * @param channelId The channel ID of the connection.
 */
export const buildConnectionButtons = (
  connected: boolean | undefined,
  channelId: string,
  opts: extraOpts = {},
) => {
  if (!opts?.disconnectEmoji || !opts.connectEmoji) {
    opts.disconnectEmoji = '🔴';
    opts.connectEmoji = '🟢';
  }

  return new ActionRowBuilder<ButtonBuilder>().addComponents([
    new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier(opts.customCustomId ?? 'connection', 'toggle')
          .setArgs(channelId)
          .setArgs(opts?.userId ?? '')
          .toString(),
      )
      .setLabel(connected ? 'Disconnect' : 'Reconnect')
      .setStyle(connected ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji(connected ? opts.disconnectEmoji : opts.connectEmoji),
  ]);
};

export default class InactiveConnectInteraction {
  @RegisterInteractionHandler('inactiveConnect', 'toggle')
  async inactiveConnect(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const [channelId] = ctx.customId.args;

    const connection = await fetchConnection(channelId);
    if (!connection) {
      const locale = await fetchUserLocale(ctx.user.id);
      const notFoundEmbed = new InfoEmbed().setDescription(
        t('connection.channelNotFound', locale, {
          emoji: getEmoji('x_icon', ctx.client),
        }),
      );

      await ctx.reply({
        embeds: [notFoundEmbed],
        flags: ['Ephemeral'],
      });
      return;
    }

    await updateConnection({ channelId }, { connected: true });

    const embed = new InfoEmbed()
      .removeTitle()
      .setDescription(
        `### ${getEmoji('tick', ctx.client)} Connection Resumed\nConnection has been resumed. Have fun chatting!`,
      );

    await ctx.editReply({ embeds: [embed], components: [] });
  }
}
