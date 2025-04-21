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

import { buildModPanel } from '#src/interactions/ModPanel.js';
import BlacklistManager from '#src/managers/BlacklistManager.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import type { ModAction } from '#src/utils/moderation/modPanel/utils.js';
import type { OriginalMessage } from '#src/utils/network/messageUtils.js';
import { deleteConnection } from '#utils/ConnectedListUtils.js';
import { CustomID } from '#utils/CustomID.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import Logger from '#utils/Logger.js';
import { sendBlacklistNotif } from '#utils/moderation/blacklistUtils.js';
import {
  ActionRowBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type Client,
  EmbedBuilder,
  ModalBuilder,
  type ModalSubmitInteraction,
  type Snowflake,
  TextInputBuilder,
  TextInputStyle,
  time,
  ButtonBuilder,
} from 'discord.js';
import ms from 'ms';

abstract class BaseBlacklistHandler implements ModAction {
  abstract handle(
    interaction: ButtonInteraction,
    originalMsgId: Snowflake,
    locale: supportedLocaleCodes,
  ): Promise<void>;

  abstract handleModal(
    interaction: ModalSubmitInteraction,
    originalMsg: OriginalMessage,
    locale: supportedLocaleCodes,
  ): Promise<void>;

  abstract handleDurationSelect(
    interaction: ButtonInteraction,
    originalMsgId: Snowflake,
    duration: string,
    locale: supportedLocaleCodes,
  ): Promise<void>;

  /**
	 * Builds a modal for blacklisting with reason field only
	 */
  buildReasonOnlyModal(
    title: string,
    type: 'user' | 'server',
    originalMsgId: Snowflake,
    duration: string,
    locale: supportedLocaleCodes,
  ) {
    return new ModalBuilder()
      .setTitle(title)
      .setCustomId(
        new CustomID()
          .setIdentifier('blacklist_reason_modal', type)
          .setArgs(originalMsgId, duration)
          .toString(),
      )
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel(t('blacklist.modal.reason.label', locale))
            .setPlaceholder(t('blacklist.modal.reason.placeholder', locale))
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500),
        ),
      );
  }

  /**
	 * Builds a modal for blacklisting with both reason and custom duration fields
	 */
  buildCustomDurationModal(
    title: string,
    type: 'user' | 'server',
    originalMsgId: Snowflake,
    locale: supportedLocaleCodes,
  ) {
    return new ModalBuilder()
      .setTitle(title)
      .setCustomId(
        new CustomID()
          .setIdentifier('blacklist_custom_modal', type)
          .setArgs(originalMsgId)
          .toString(),
      )
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel(t('blacklist.modal.reason.label', locale))
            .setPlaceholder(t('blacklist.modal.reason.placeholder', locale))
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('duration')
            .setLabel(t('blacklist.modal.duration.label', locale))
            .setPlaceholder(t('blacklist.modal.duration.placeholder', locale))
            .setStyle(TextInputStyle.Short)
            .setMinLength(2)
            .setRequired(true),
        ),
      );
  }

  /**
	 * Builds duration selection buttons for blacklisting
	 */
  buildDurationButtons(type: 'user' | 'server', originalMsgId: Snowflake) {
    // First row: 10m, 30m, 1h, 2h, 6h
    const firstRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('blacklist_duration', type)
            .setArgs(originalMsgId, '10m')
            .toString(),
        )
        .setLabel('10m')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('blacklist_duration', type)
            .setArgs(originalMsgId, '30m')
            .toString(),
        )
        .setLabel('30m')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('blacklist_duration', type)
            .setArgs(originalMsgId, '1h')
            .toString(),
        )
        .setLabel('1h')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('blacklist_duration', type)
            .setArgs(originalMsgId, '2h')
            .toString(),
        )
        .setLabel('2h')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('blacklist_duration', type)
            .setArgs(originalMsgId, '6h')
            .toString(),
        )
        .setLabel('6h')
        .setStyle(ButtonStyle.Secondary),
    );

    // Second row: 12h, 24h, 7d, 1mo, 1y
    const secondRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('blacklist_duration', type)
            .setArgs(originalMsgId, '12h')
            .toString(),
        )
        .setLabel('12h')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('blacklist_duration', type)
            .setArgs(originalMsgId, '24h')
            .toString(),
        )
        .setLabel('24h')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('blacklist_duration', type)
            .setArgs(originalMsgId, '7d')
            .toString(),
        )
        .setLabel('7d')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('blacklist_duration', type)
            .setArgs(originalMsgId, '1mo')
            .toString(),
        )
        .setLabel('1mo')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('blacklist_duration', type)
            .setArgs(originalMsgId, '1y')
            .toString(),
        )
        .setLabel('1y')
        .setStyle(ButtonStyle.Secondary),
    );

    // Third row: Permanent, Custom
    const thirdRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('blacklist_duration', type)
            .setArgs(originalMsgId, 'permanent')
            .toString(),
        )
        .setLabel('Permanent')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('blacklist_duration', type)
            .setArgs(originalMsgId, 'custom')
            .toString(),
        )
        .setLabel('Custom')
        .setStyle(ButtonStyle.Primary),
    );

    return [firstRow, secondRow, thirdRow];
  }

  /**
	 * Extracts data from a modal submission
	 */
  protected getModalData(
    interaction: ModalSubmitInteraction,
    predefinedDuration?: string,
  ) {
    const reason = interaction.fields.getTextInputValue('reason');
    let expiresAt: Date | null = null;

    // If we have a predefined duration from the button
    if (predefinedDuration) {
      if (predefinedDuration !== 'permanent') {
        const duration = ms(predefinedDuration as ms.StringValue);
        expiresAt = duration ? new Date(Date.now() + duration) : null;
      }
      // If permanent, expiresAt remains null
    }
    // Otherwise get duration from the modal input
    else if (interaction.fields.getTextInputValue('duration')) {
      const duration = ms(
        interaction.fields.getTextInputValue('duration') as ms.StringValue,
      );
      expiresAt = duration ? new Date(Date.now() + duration) : null;
    }

    return { reason, expiresAt };
  }

  protected buildSuccessEmbed(
    name: string,
    reason: string,
    expires: Date | null,
    client: Client,
    locale: supportedLocaleCodes,
  ) {
    return new EmbedBuilder()
      .setColor('Green')
      .setDescription(
        t('blacklist.success', locale, {
          name,
          emoji: getEmoji('tick', client),
        }),
      )
      .addFields(
        {
          name: 'Reason',
          value: reason ?? t('global.noReason', locale),
          inline: true,
        },
        {
          name: 'Expires',
          value: expires
            ? `${time(Math.round(expires.getTime() / 1000), 'R')}`
            : 'Never.',
          inline: true,
        },
      );
  }
}

export class BlacklistUserHandler extends BaseBlacklistHandler {
  async handle(interaction: ButtonInteraction, originalMsgId: Snowflake) {
    // Show duration selection buttons instead of modal directly
    const durationButtons = this.buildDurationButtons('user', originalMsgId);
    await interaction.reply({
      content: 'Select blacklist duration:',
      components: durationButtons,
      flags: ['Ephemeral'],
    });
  }

  /**
	 * Handles the duration selection button click
	 */
  async handleDurationSelect(
    interaction: ButtonInteraction,
    originalMsgId: Snowflake,
    duration: string,
    locale: supportedLocaleCodes,
  ) {
    if (duration === 'custom') {
      // For custom duration, show the modal with both fields
      await interaction.showModal(
        this.buildCustomDurationModal(
          'Blacklist User',
          'user',
          originalMsgId,
          locale,
        ),
      );
    }
    else {
      // For predefined durations, show modal with only reason field
      await interaction.showModal(
        this.buildReasonOnlyModal(
          'Blacklist User',
          'user',
          originalMsgId,
          duration,
          locale,
        ),
      );
    }
  }

  async handleModal(
    interaction: ModalSubmitInteraction,
    originalMsg: OriginalMessage,
    locale: supportedLocaleCodes,
  ) {
    // Extract duration from customId if it's a reason-only modal
    const customId = CustomID.parseCustomId(interaction.customId);
    const predefinedDuration =
			customId.prefix === 'blacklist_reason_modal'
			  ? customId.args[1]
			  : undefined;
    const user = await interaction.client.users
      .fetch(originalMsg.authorId)
      .catch(() => null);

    if (!user) {
      await interaction.reply({
        content: `${getEmoji('neutral', interaction.client)} Unable to fetch user. They may have deleted their account?`,
        flags: ['Ephemeral'],
      });
      return;
    }

    if (!originalMsg.hubId) {
      await interaction.reply({
        content: t('hub.notFound_mod', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    if (originalMsg.authorId === interaction.user.id) {
      await interaction.followUp({
        content:
					'<a:nuhuh:1256859727158050838> Nuh uh! You can\'t blacklist yourself.',
        flags: ['Ephemeral'],
      });
      return;
    }

    const { reason, expiresAt } = this.getModalData(
      interaction,
      predefinedDuration,
    );
    const blacklistManager = new BlacklistManager('user', user.id);

    await blacklistManager.addBlacklist({
      hubId: originalMsg.hubId,
      moderatorId: interaction.user.id,
      reason,
      expiresAt,
    });

    await blacklistManager.log(originalMsg.hubId, interaction.client, {
      mod: interaction.user,
      reason,
      expiresAt,
    });

    Logger.info(
      `User ${user?.username} blacklisted by ${interaction.user.username} in ${originalMsg.hubId}`,
    );

    const { embed, buttons } = await buildModPanel(interaction, originalMsg);
    await interaction.editReply({ embeds: [embed], components: buttons });

    const successEmbed = this.buildSuccessEmbed(
      user.username,
      reason,
      expiresAt,
      interaction.client,
      locale,
    );
    await interaction.followUp({
      embeds: [successEmbed],
      components: [],
      flags: ['Ephemeral'],
    });
  }
}

export class BlacklistServerHandler extends BaseBlacklistHandler {
  async handle(interaction: ButtonInteraction, originalMsgId: Snowflake) {
    // Show duration selection buttons instead of modal directly
    const durationButtons = this.buildDurationButtons('server', originalMsgId);
    await interaction.reply({
      content: 'Select blacklist duration:',
      components: durationButtons,
      flags: ['Ephemeral'],
    });
  }

  /**
	 * Handles the duration selection button click
	 */
  async handleDurationSelect(
    interaction: ButtonInteraction,
    originalMsgId: Snowflake,
    duration: string,
    locale: supportedLocaleCodes,
  ) {
    if (duration === 'custom') {
      // For custom duration, show the modal with both fields
      await interaction.showModal(
        this.buildCustomDurationModal(
          'Blacklist Server',
          'server',
          originalMsgId,
          locale,
        ),
      );
    }
    else {
      // For predefined durations, show modal with only reason field
      await interaction.showModal(
        this.buildReasonOnlyModal(
          'Blacklist Server',
          'server',
          originalMsgId,
          duration,
          locale,
        ),
      );
    }
  }

  async handleModal(
    interaction: ModalSubmitInteraction,
    originalMsg: OriginalMessage,
    locale: supportedLocaleCodes,
  ) {
    // Extract duration from customId if it's a reason-only modal
    const customId = CustomID.parseCustomId(interaction.customId);
    const predefinedDuration =
			customId.prefix === 'blacklist_reason_modal'
			  ? customId.args[1]
			  : undefined;
    const client = interaction.client;

    if (!originalMsg.hubId) {
      await interaction.reply({
        content: t('hub.notFound_mod', locale, {
          emoji: getEmoji('x_icon', client),
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    const server = await interaction.client.fetchGuild(originalMsg.guildId);
    if (!server) {
      await interaction.reply({
        content: t('errors.unknownServer', locale, {
          emoji: getEmoji('x_icon', client),
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    const { reason, expiresAt } = this.getModalData(
      interaction,
      predefinedDuration,
    );
    const blacklistManager = new BlacklistManager(
      'server',
      originalMsg.guildId,
    );

    await blacklistManager.addBlacklist({
      reason,
      expiresAt,
      hubId: originalMsg.hubId,
      serverName: server?.name ?? 'Unknown Server',
      moderatorId: interaction.user.id,
    });

    // Notify server of blacklist
    await sendBlacklistNotif('server', interaction.client, {
      target: { id: originalMsg.guildId },
      hubId: originalMsg.hubId,
      expiresAt,
      reason,
    });

    await deleteConnection({
      hubId_serverId: {
        hubId: originalMsg.hubId,
        serverId: originalMsg.guildId,
      },
    });

    if (server) {
      await blacklistManager
        .log(originalMsg.hubId, interaction.client, {
          mod: interaction.user,
          reason,
          expiresAt,
        })
        .catch(() => null);
    }

    const successEmbed = this.buildSuccessEmbed(
      server.name,
      reason,
      expiresAt,
      client,
      locale,
    );

    const { embed, buttons } = await buildModPanel(interaction, originalMsg);
    await interaction.editReply({ embeds: [embed], components: buttons });
    await interaction.followUp({
      embeds: [successEmbed],
      components: [],
      flags: ['Ephemeral'],
    });
  }
}
