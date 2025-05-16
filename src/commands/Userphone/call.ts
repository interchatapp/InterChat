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
import { CallService } from '#src/services/CallService.js';
import Constants from '#src/utils/Constants.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { formatUserLeaderboard, getCallLeaderboard } from '#src/utils/Leaderboard.js';
import { CustomID } from '#utils/CustomID.js';
import { stripIndents } from 'common-tags';
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
      types: { slash: true, prefix: true },
      contexts: { guildOnly: true },
    });
  }

  async execute(ctx: Context) {
    const ui = new UIComponents(ctx.client);

    await ctx.deferReply();

    const callService = new CallService(ctx.client);
    const result = await callService.initiateCall(
      ctx.channel as GuildTextBasedChannel,
      ctx.user.id,
    );

    // Create a container for the call status
    const container = new ContainerBuilder();

    // Add beta notice and hub promotion at the top
    container.addTextDisplayComponents(
      ui.createSubsection(
        '🌟 Discover InterChat Hubs!',
        'Calls are in beta. For a more reliable experience, try InterChat Hubs - our main feature for connecting servers!',
        'info_icon',
      ),
    );

    if (result.success) {
      // Call was initiated successfully
      if (result.message.includes('queue')) {
        // In queue - waiting for match
        const headerText = ui.createHeader(
          'Call Initiated',
          'Waiting for another server • Use </hangup:1350402702760218624> to cancel • Follow our [guidelines](https://interchat.tech/guidelines)',
          'call_icon',
        );
        container.addTextDisplayComponents(headerText);

        // Add cancel button
        ui.createActionButtons(
          container,
          {
            label: 'Cancel Call',
            customId: new CustomID().setIdentifier('call', 'cancel').toString(),
            emoji: 'hangup_icon',
          },
          {
            label: 'View Leaderboard',
            customId: new CustomID().setIdentifier('call', 'leaderboard').toString(),
            emoji: 'trophy_icon',
          },
        );
      }
      else {
        // Connected immediately
        const successText = new TextDisplayBuilder().setContent(
          `## ${getEmoji('tick_icon', ctx.client)} Call Connected!\nYou've been connected to another server • Use \`/hangup\` to end • \`/skip\` to find another server`,
        );
        container.addTextDisplayComponents(successText);

        // Add buttons
        ui.createActionButtons(
          container,
          {
            label: 'End Call',
            customId: new CustomID().setIdentifier('call', 'hangup').toString(),
            emoji: 'hangup_icon',
          },
          {
            label: 'Skip Server',
            customId: new CustomID().setIdentifier('call', 'skip').toString(),
            emoji: 'skip_icon',
          },
        );
      }
    }
    else {
      // Error occurred
      const errorText = new TextDisplayBuilder().setContent(
        `## ${getEmoji('x_icon', ctx.client)} Call Failed\n${result.message}\n\nCheck you're not already in a call and try again in a few moments.`,
      );
      container.addTextDisplayComponents(errorText);
    }

    // Add hub exploration button at the bottom
    ui.createActionButtons(
      container,
      {
        label: 'Explore Hubs',
        customId: new CustomID().setIdentifier('call', 'explore-hubs').toString(),
        emoji: 'house_icon',
      },
    );

    await ctx.editOrReply({ components: [container] }, ['IsComponentsV2']);
  }

  @RegisterInteractionHandler('call', 'cancel')
  async handleCancelButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    if (!ctx.inGuild()) return;

    const callService = new CallService(ctx.client);
    await callService.hangup(ctx.channelId);

    const ui = new UIComponents(ctx.client);
    const container = ui.createSuccessMessage(
      'Call Cancelled',
      'Call queue exited. Use `/call` to start a new call.',
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

    const callService = new CallService(ctx.client);
    const result = await callService.hangup(ctx.channelId);

    // Create combined rating and report UI
    const ratingRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(new CustomID('rate_call:like', [result.callId || '']).toString())
        .setLabel('👍 Like')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(new CustomID('rate_call:dislike', [result.callId || '']).toString())
        .setLabel('👎 Dislike')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(new CustomID('report_call', [result.callId || '']).toString())
        .setLabel('Report')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🚩'),
    );

    const ui = new UIComponents(ctx.client);
    const container = ui.createInfoMessage(
      'Call Ended',
      'Rate your experience or start a new call',
    );

    // Add new call button
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID().setIdentifier('hangup', 'new-call').toString())
          .setLabel('New Call')
          .setStyle(ButtonStyle.Primary)
          .setEmoji(ctx.getEmoji('call_icon')),
      ),
    );

    await ctx.editReply({
      components: [container, ratingRow],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  @RegisterInteractionHandler('call', 'skip')
  async handleSkipButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    if (!ctx.inGuild()) return;

    const callService = new CallService(ctx.client);
    const result = await callService.skip(ctx.channelId, ctx.user.id);

    const ui = new UIComponents(ctx.client);

    if (result.success) {
      // Call was skipped successfully
      if (result.message.includes('queue')) {
        // In queue - waiting for match
        const container = new ContainerBuilder();

        container.addTextDisplayComponents(
          ui.createHeader(
            'Finding New Call',
            'Previous call ended • Waiting for another server • Use </hangup:1350402702760218624> to cancel',
            'call_icon',
          ),
        );

        // Add cancel button
        ui.createActionButtons(container, {
          label: 'Cancel Call',
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
          ui.createHeader(
            'New Call Connected!',
            'You\'ve been connected to a different server • Use `/hangup` to end',
            'tick_icon',
          ),
        );

        // Add buttons
        ui.createActionButtons(
          container,
          {
            label: 'End Call',
            customId: new CustomID().setIdentifier('call', 'hangup').toString(),
            emoji: 'hangup_icon',
          },
          {
            label: 'Skip Again',
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
      const container = ui.createErrorMessage('Skip Failed', result.message);

      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  @RegisterInteractionHandler('call', 'leaderboard')
  async handleLeaderboardButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    // Default to user leaderboard
    const userLeaderboard = await getCallLeaderboard('user', 10);
    const userLeaderboardFormatted = await formatUserLeaderboard(userLeaderboard, ctx.client, 'calls');

    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader('Global Calls Leaderboard', 'Shows data from this month', 'call_icon'),
    );

    // Add leaderboard content
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        userLeaderboardFormatted.length > 0 ? userLeaderboardFormatted : 'No data available.',
      ),
    );

    // Add toggle buttons
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID('calls_lb:user').toString())
          .setLabel('User Leaderboard')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(new CustomID('calls_lb:server').toString())
          .setLabel('Server Leaderboard')
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

    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Add header
    container.addTextDisplayComponents(
      ui.createHeader(
        'InterChat Hubs',
        'Hubs are the main feature of InterChat, connecting servers in persistent chat communities',
        'house_icon',
      ),
    );

    // Add separator
    ui.addSeparator(container);

    // Add hub description
    container.addTextDisplayComponents(
      ui.createSection(
        'Why Choose Hubs?',
        'Hubs offer a more reliable and feature-rich experience than calls:',
      ),
    );

    // Add hub benefits
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        stripIndents`
        • **Persistent Connections** - Messages stay even when you're offline
        • **Multiple Communities** - Join various themed hubs or create your own
        • **Advanced Moderation** - Content filtering, anti-spam, and more
        • **Rich Features** - Custom welcome messages, rules, and settings
        • **Active Communities** - Thousands of servers already connected
        `,
      ),
    );

    // Add URL button
    ui.createActionButtons(
      container,
      {
        label: 'Browse All Hubs',
        url: `${Constants.Links.Website}/hubs`,
        emoji: 'globe_icon',
      },
    );

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

    // Add create hub button separately since it needs customId
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID().setIdentifier('call', 'redirect-create').toString())
          .setLabel('Create Your Hub')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(ctx.getEmoji('plus_icon')),
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
      await ctx.reply({
        content: `${ctx.getEmoji('x_icon')} Could not find the connect command. Please use \`/connect\` manually.`,
        flags: ['Ephemeral'],
      });
    }
  }

  @RegisterInteractionHandler('call', 'redirect-create')
  async handleRedirectCreateButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const ui = new UIComponents(ctx.client);
    const container = ui.createInfoMessage(
      'Create a New Hub',
      'To create your own hub, use the `/hub create` command and follow the prompts.',
    );

    // Add button to create hub
    ui.createActionButtons(container, {
      label: 'Create Hub',
      customId: new CustomID().setIdentifier('connect', 'redirect-create').toString(),
      emoji: 'plus_icon',
    });

    await ctx.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2, 'Ephemeral'],
    });
  }
}
