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
import BlacklistManager from '#src/managers/BlacklistManager.js';
import { HubService } from '#src/services/HubService.js';
import { CustomID } from '#src/utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { sendBlacklistNotif } from '#src/utils/moderation/blacklistUtils.js';
import { deleteConnection } from '#utils/ConnectedListUtils.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import ms from 'ms';

/**
 * Builds duration selection buttons for blacklisting
 */
export function buildDurationButtons(type: 'user' | 'server', hubId: string, targetId: string) {
  // First row: 10m, 30m, 1h, 2h, 6h
  const firstRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('blacklist_cmd_duration', type)
          .setArgs(hubId, targetId, '10m')
          .toString(),
      )
      .setLabel('10m')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('blacklist_cmd_duration', type)
          .setArgs(hubId, targetId, '30m')
          .toString(),
      )
      .setLabel('30m')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('blacklist_cmd_duration', type)
          .setArgs(hubId, targetId, '1h')
          .toString(),
      )
      .setLabel('1h')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('blacklist_cmd_duration', type)
          .setArgs(hubId, targetId, '2h')
          .toString(),
      )
      .setLabel('2h')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('blacklist_cmd_duration', type)
          .setArgs(hubId, targetId, '6h')
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
          .setIdentifier('blacklist_cmd_duration', type)
          .setArgs(hubId, targetId, '12h')
          .toString(),
      )
      .setLabel('12h')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('blacklist_cmd_duration', type)
          .setArgs(hubId, targetId, '24h')
          .toString(),
      )
      .setLabel('24h')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('blacklist_cmd_duration', type)
          .setArgs(hubId, targetId, '7d')
          .toString(),
      )
      .setLabel('7d')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('blacklist_cmd_duration', type)
          .setArgs(hubId, targetId, '1mo')
          .toString(),
      )
      .setLabel('1mo')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('blacklist_cmd_duration', type)
          .setArgs(hubId, targetId, '1y')
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
          .setIdentifier('blacklist_cmd_duration', type)
          .setArgs(hubId, targetId, 'permanent')
          .toString(),
      )
      .setLabel('Permanent')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(
        new CustomID()
          .setIdentifier('blacklist_cmd_duration', type)
          .setArgs(hubId, targetId, 'custom')
          .toString(),
      )
      .setLabel('Custom')
      .setStyle(ButtonStyle.Primary),
  );

  return [firstRow, secondRow, thirdRow];
}

/**
 * Builds a modal for blacklisting with reason field only
 */
export function buildReasonOnlyModal(
  title: string,
  type: 'user' | 'server',
  hubId: string,
  targetId: string,
  duration: string,
) {
  return new ModalBuilder()
    .setTitle(title)
    .setCustomId(
      new CustomID()
        .setIdentifier('blacklist_cmd_reason_modal', type)
        .setArgs(hubId, targetId, duration)
        .toString(),
    )
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason')
          .setPlaceholder('Reason for blacklisting...')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(500),
      ),
    );
}

/**
 * Builds a modal for blacklisting with both reason and custom duration fields
 */
export function buildCustomDurationModal(
  title: string,
  type: 'user' | 'server',
  hubId: string,
  targetId: string,
) {
  return new ModalBuilder()
    .setTitle(title)
    .setCustomId(
      new CustomID()
        .setIdentifier('blacklist_cmd_custom_modal', type)
        .setArgs(hubId, targetId)
        .toString(),
    )
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason')
          .setPlaceholder('Reason for blacklisting...')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(500),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('Duration')
          .setPlaceholder('e.g. 1d, 12h, 30m')
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setRequired(true),
      ),
    );
}

/**
 * Extracts data from a modal submission
 */
export function getModalData(ctx: ComponentContext, predefinedDuration?: string) {
  const reason = ctx.getModalFieldValue('reason') ?? 'No reason provided.';
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
  else if (ctx.getModalFieldValue('duration')) {
    const duration = ms(ctx.getModalFieldValue('duration') as ms.StringValue);
    expiresAt = duration ? new Date(Date.now() + duration) : null;
  }

  return { reason, expiresAt };
}

export default class BlacklistCommandHandler {
  private readonly hubService = new HubService();

  @RegisterInteractionHandler('blacklist_cmd_duration', 'user')
  async handleUserDurationSelect(ctx: ComponentContext): Promise<void> {
    const [hubId, userId, duration] = ctx.customId.args;

    if (duration === 'custom') {
      // For custom duration, show the modal with both fields
      await ctx.showModal(
        buildCustomDurationModal('Blacklist User', 'user', hubId, userId),
      );
    }
    else {
      // For predefined durations, show modal with only reason field
      await ctx.showModal(
        buildReasonOnlyModal('Blacklist User', 'user', hubId, userId, duration),
      );
    }
  }

  @RegisterInteractionHandler('blacklist_cmd_reason_modal', 'user')
  @RegisterInteractionHandler('blacklist_cmd_custom_modal', 'user')
  async handleUserModal(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const [hubId, userId, predefinedDuration] = ctx.customId.args;

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Hub not found.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const user = await ctx.client.users.fetch(userId).catch(() => null);
    if (!user) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} User not found.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    if (userId === ctx.user.id) {
      await ctx.reply({
        content: '<a:nuhuh:1256859727158050838> Nuh uh! You can\'t blacklist yourself.',
        flags: ['Ephemeral'],
      });
      return;
    }

    const { reason, expiresAt } = getModalData(ctx, predefinedDuration);
    const blacklistManager = new BlacklistManager('user', userId);

    await blacklistManager.addBlacklist({
      hubId,
      moderatorId: ctx.user.id,
      reason,
      expiresAt,
    });

    await blacklistManager.log(hubId, ctx.client, {
      mod: ctx.user,
      reason,
      expiresAt,
    });

    await ctx.reply({
      content: `${getEmoji('tick_icon', ctx.client)} Successfully blacklisted ${user.username}.`,
      flags: ['Ephemeral'],
    });
  }

  @RegisterInteractionHandler('blacklist_cmd_duration', 'server')
  async handleServerDurationSelect(ctx: ComponentContext): Promise<void> {
    const [hubId, serverId, duration] = ctx.customId.args;

    if (duration === 'custom') {
      // For custom duration, show the modal with both fields
      await ctx.showModal(
        buildCustomDurationModal('Blacklist Server', 'server', hubId, serverId),
      );
    }
    else {
      // For predefined durations, show modal with only reason field
      await ctx.showModal(
        buildReasonOnlyModal('Blacklist Server', 'server', hubId, serverId, duration),
      );
    }
  }

  @RegisterInteractionHandler('blacklist_cmd_reason_modal', 'server')
  @RegisterInteractionHandler('blacklist_cmd_custom_modal', 'server')
  async handleServerModal(ctx: ComponentContext): Promise<void> {
    await ctx.deferUpdate();

    const [hubId, serverId, predefinedDuration] = ctx.customId.args;

    const hub = await this.hubService.fetchHub(hubId);
    if (!hub) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Hub not found.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const server = await ctx.client.fetchGuild(serverId).catch(() => null);
    if (!server) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} Server not found.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    const { reason, expiresAt } = getModalData(ctx, predefinedDuration);
    const blacklistManager = new BlacklistManager('server', serverId);

    await blacklistManager.addBlacklist({
      hubId,
      moderatorId: ctx.user.id,
      reason,
      expiresAt,
      serverName: server.name,
    });

    await blacklistManager.log(hubId, ctx.client, {
      mod: ctx.user,
      reason,
      expiresAt,
    });

    // Notify server of blacklist
    await sendBlacklistNotif('server', ctx.client, {
      target: { id: serverId },
      hubId,
      expiresAt,
      reason,
    });

    // Disconnect the server
    await deleteConnection({ hubId_serverId: { hubId, serverId } });

    await ctx.reply({
      content: `${getEmoji('tick_icon', ctx.client)} Successfully blacklisted ${server.name}.`,
      flags: ['Ephemeral'],
    });
  }
}
