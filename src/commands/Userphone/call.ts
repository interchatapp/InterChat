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
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { createCallRatingRow } from '#src/utils/ComponentUtils.js';
import Constants from '#src/utils/Constants.js';
import { UIComponents } from '#src/utils/DesignSystem.js';

import { formatUserLeaderboard, getCallLeaderboard } from '#src/utils/Leaderboard.js';
import { t } from '#src/utils/Locale.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { CustomID } from '#utils/CustomID.js';

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  GuildTextBasedChannel,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js';

/**
 * Redesigned call command using the InterChat v5 design system
 */
export default class CallCommand extends BaseCommand {
  constructor() {
    super({
      name: 'call',
      description: '📞 [BETA] Start a call with another server',
      aliases: ['c'],
      examples: ['i.call', 'i.c'],
      types: { slash: true, prefix: true },
      contexts: { guildOnly: true },
    });
  }

  async execute(ctx: Context) {
    const distributedCallingLibrary = ctx.client.getDistributedCallingLibrary();
    if (!distributedCallingLibrary) {
      await ctx.reply(
        `${ctx.getEmoji('x_icon')} Call system is currently unavailable. Please try again later.`,
      );
      return;
    }

    // Parallel execution for performance
    const [result, locale] = await Promise.all([
      distributedCallingLibrary.initiateCall(
        ctx.channel as GuildTextBasedChannel,
        ctx.user.id,
      ),
      ctx.getLocale(),
    ]);

    // Pre-build UI components for faster response
    const tipButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID().setIdentifier('hangup', 'explore-hubs').toString())
        .setLabel(t('calls.buttons.exploreHubs', locale))
        .setStyle(ButtonStyle.Primary)
        .setEmoji(ctx.getEmoji('house_icon')),
    );

    await ctx.reply({
      content: `${result.message}\n**Tip:** Try InterChat Hubs for a more reliable experience!`,
      components: [tipButton],
    });
  }

  @RegisterInteractionHandler('call', 'cancel')
  async handleCancelButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    if (!ctx.inGuild()) return;

    const distributedCallingLibrary = ctx.client.getDistributedCallingLibrary();
    if (!distributedCallingLibrary) {
      // Fast error response without locale lookup
      const ui = new UIComponents(ctx.client);
      const container = ui.createCompactErrorMessage(
        'Call Failed',
        'Call system is currently unavailable. Please try again later.',
      );
      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    // Parallel execution for performance
    const [, locale] = await Promise.all([
      distributedCallingLibrary.hangupCall(ctx.channelId),
      ctx.getLocale(),
    ]);

    const ui = new UIComponents(ctx.client);
    const container = ui.createCompactSuccessMessage(
      t('calls.cancelled.title', locale),
      t('calls.cancelled.description', locale),
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('call', 'hangup')
  async handleHangupButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    if (!ctx.inGuild()) return;

    const distributedCallingLibrary = ctx.client.getDistributedCallingLibrary();
    if (!distributedCallingLibrary) {
      // Fast error response without locale lookup
      const ui = new UIComponents(ctx.client);
      const container = ui.createCompactErrorMessage(
        'Call Failed',
        'Call system is currently unavailable. Please try again later.',
      );
      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    // Parallel execution for performance
    const [result, locale] = await Promise.all([
      distributedCallingLibrary.hangupCall(ctx.channelId),
      fetchUserLocale(ctx.user.id),
    ]);

    // Pre-build UI components
    const ui = new UIComponents(ctx.client);
    const container = ui.createCompactInfoMessage(
      t('calls.ended.title', locale),
      t('calls.ended.description', locale),
    );

    // Add new call button
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID().setIdentifier('hangup', 'new-call').toString())
          .setLabel(t('calls.buttons.newCall', locale))
          .setStyle(ButtonStyle.Primary)
          .setEmoji(ctx.getEmoji('call_icon')),
      ),
    );

    // Create rating row after main UI
    const ratingRow = createCallRatingRow(result.callId || '', locale);

    await ctx.editReply({
      components: [container, ratingRow],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('call', 'skip')
  async handleSkipButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    if (!ctx.inGuild()) return;

    const distributedCallingLibrary = ctx.client.getDistributedCallingLibrary();
    if (!distributedCallingLibrary) {
      // Fast error response without locale lookup
      const ui = new UIComponents(ctx.client);
      const container = ui.createCompactErrorMessage(
        'Call Failed',
        'Call system is currently unavailable. Please try again later.',
      );
      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    // Parallel execution for performance
    const [result, locale] = await Promise.all([
      distributedCallingLibrary.skipCall(ctx.channelId, ctx.user.id),
      ctx.getLocale(),
    ]);

    const ui = new UIComponents(ctx.client);

    if (result.success) {
      // Call was skipped successfully
      if (result.message.includes('queue') || result.message.includes('Looking for a Match') || result.message.includes('looking for a new match')) {
        // In queue - waiting for match
        const container = new ContainerBuilder();

        container.addTextDisplayComponents(
          ui.createCompactHeader(
            t('calls.skip.title', locale),
            t('calls.skip.description', locale),
            'call_icon',
          ),
        );

        // Add cancel button
        ui.createActionButtons(container, {
          label: t('calls.buttons.cancelCall', locale),
          customId: new CustomID().setIdentifier('call', 'cancel').toString(),
          emoji: 'hangup_icon',
        });

        await ctx.editReply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        });
      }
      else {
        // Connected immediately
        const container = new ContainerBuilder();

        container.addTextDisplayComponents(
          ui.createCompactHeader(
            t('calls.skip.newConnected.title', locale),
            t('calls.skip.newConnected.description', locale),
            'tick_icon',
          ),
        );

        // Add buttons
        ui.createActionButtons(
          container,
          {
            label: t('calls.buttons.endCall', locale),
            customId: new CustomID().setIdentifier('call', 'hangup').toString(),
            emoji: 'hangup_icon',
          },
          {
            label: t('calls.buttons.skipAgain', locale),
            customId: new CustomID().setIdentifier('call', 'skip').toString(),
            emoji: 'skip_icon',
          },
        );

        await ctx.editReply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        });
      }
    }
    else {
      // Error occurred
      const container = ui.createCompactErrorMessage(t('calls.skip.error', locale), result.message);

      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  @RegisterInteractionHandler('call', 'leaderboard')
  async handleLeaderboardButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const locale = await ctx.getLocale();

    // Default to user leaderboard
    const userLeaderboard = await getCallLeaderboard('user', 10);
    const userLeaderboardFormatted = await formatUserLeaderboard(
      userLeaderboard,
      ctx.client,
      'calls',
    );

    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createCompactHeader(
        t('calls.leaderboard.title', locale),
        t('calls.leaderboard.description', locale),
        'call_icon',
      ),
    );

    // Add leaderboard content
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        userLeaderboardFormatted.length > 0
          ? userLeaderboardFormatted
          : t('calls.leaderboard.noData', locale),
      ),
    );

    // Add toggle buttons
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('calls_lb:user').toString())
          .setLabel(t('calls.leaderboard.userTab', locale))
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(new CustomID('calls_lb:server').toString())
          .setLabel(t('calls.leaderboard.serverTab', locale))
          .setStyle(ButtonStyle.Secondary),
      ),
    );

    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('call', 'explore-hubs')
  async handleExploreHubsButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const locale = await ctx.getLocale();
    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader(
        t('calls.hubs.main.title', locale),
        t('calls.hubs.main.description', locale),
        'house_icon',
      ),
    );

    // Add separator
    ui.addSeparator(container);

    // Add hub description
    container.addTextDisplayComponents(
      ui.createSection(
        t('calls.hubs.benefits.title', locale),
        t('calls.hubs.benefits.description', locale),
      ),
    );

    // Add hub benefits
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(t('calls.hubs.benefits.list', locale)),
    );

    // Add URL button
    ui.createActionButtons(container, {
      label: t('calls.buttons.browseAllHubs', locale),
      url: `${Constants.Links.Website}/hubs`,
      emoji: 'globe_icon',
    });

    // Add connect button separately
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID().setIdentifier('call', 'redirect-connect').toString())
          .setLabel('Connect to a Hub')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔗'),
      ),
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('call', 'redirect-connect')
  async handleRedirectConnectButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    // Create a new context to simulate running the connect command
    const connectCommand = ctx.client.commands.get('connect');
    if (connectCommand?.execute) {
      await connectCommand.execute(ctx);
    }
    else {
      const locale = await ctx.getLocale();
      await ctx.reply({
        content: t('call.errors.connectNotFound', locale, {
          emoji: ctx.getEmoji('x_icon'),
        }),
        flags: ['Ephemeral'],
      });
    }
  }
}
