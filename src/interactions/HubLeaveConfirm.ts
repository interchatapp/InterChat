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

import { ActionRowBuilder, ButtonBuilder, type ButtonInteraction, ButtonStyle } from 'discord.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { HubService } from '#src/services/HubService.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { t } from '#src/utils/Locale.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { logGuildLeaveToHub } from '#src/utils/hub/logger/JoinLeave.js';

export const hubLeaveConfirmButtons = (channelId: string, hubId: string) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents([
    new ButtonBuilder()
      .setCustomId(new CustomID('hub_leave:yes', [channelId, hubId]).toString())
      .setLabel('Yes')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(new CustomID('hub_leave:no', [channelId, hubId]).toString())
      .setLabel('No')
      .setStyle(ButtonStyle.Danger),
  ]);

export default class ModActionsButton {
  private readonly hubService = new HubService();

  @RegisterInteractionHandler('hub_leave')
  async handler(interaction: ButtonInteraction): Promise<void> {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [channelId, hubId] = customId.args;

    if (customId.suffix === 'no') {
      await interaction.deferUpdate();
      await interaction.deleteReply();
      return;
    }

    const locale = await fetchUserLocale(interaction.user.id);

    const hub = await this.hubService.fetchHub(hubId);
    const success = await hub?.connections.deleteConnection(channelId);

    if (!hub || !success) {
      await interaction.update({
        content: t('hub.leave.noHub', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
        embeds: [],
        components: [],
      });
    }

    await interaction.update({
      content: t('hub.leave.success', locale, {
        channel: `<#${channelId}>`,
        emoji: getEmoji('tick_icon', interaction.client),
      }),
      embeds: [],
      components: [],
    });

    // log server leave
    if (interaction.guild) {
      await logGuildLeaveToHub(hubId, interaction.guild);
    }
  }
}
