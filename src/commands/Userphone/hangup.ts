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
import Context from '#src/core/CommandContext/Context.js';
import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { CallService } from '#src/services/CallService.js';
import Constants from '#src/utils/Constants.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { CustomID } from '#utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
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
 * Redesigned hangup command using the InterChat v5 design system
 */
export default class HangupCommand extends BaseCommand {
  constructor() {
    super({
      name: 'hangup',
      description: '📞 End the current call',
      types: { slash: true, prefix: true },
      contexts: { guildOnly: true },
    });
  }

  async execute(ctx: Context) {
    if (!ctx.inGuild() || !ctx.channelId) return;

    await ctx.deferReply();

    const callService = new CallService(ctx.client);
    const result = await callService.hangup(ctx.channelId);

    const ui = new UIComponents(ctx.client);

    if (result.success) {
      // Check if this was a queue exit or an active call end
      if (result.message.includes('queue')) {
        // Was in queue, not in active call
        const container = ui.createSuccessMessage(
          'Call Cancelled',
          'You have been removed from the call queue',
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
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        });
      }
      else {
        // Was in active call
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

        // Create success message
        const container = ui.createSuccessMessage(
          'Call Ended',
          'Rate your experience or try InterChat\'s main feature - Hubs!',
        );

        // Add hub and call buttons
        container.addActionRowComponents((row) =>
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(new CustomID().setIdentifier('hangup', 'explore-hubs').toString())
              .setLabel('Explore Hubs')
              .setStyle(ButtonStyle.Primary)
              .setEmoji(ctx.getEmoji('house_icon')),
            new ButtonBuilder()
              .setCustomId(new CustomID().setIdentifier('hangup', 'new-call').toString())
              .setLabel('New Call')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji(ctx.getEmoji('call_icon')),
          ),
        );

        await ctx.editReply({
          components: [container, ratingRow],
          flags: [MessageFlags.IsComponentsV2],
        });

        // Also send a message to the channel to notify everyone
        if (ctx.channel && 'send' in ctx.channel) {
          await ctx.channel.send({
            content: `${ctx.user} ended the call.`,
          });
        }
      }
    }
    else {
      // Error occurred
      const container = ui.createErrorMessage('Error', result.message);

      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  @RegisterInteractionHandler('hangup', 'explore-hubs')
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

    // Add action buttons for URL button
    ui.createActionButtons(
      container,
      {
        label: 'Browse All Hubs',
        url: `${Constants.Links.Website}/hubs`,
        emoji: 'globe_icon',
      },
    );

    // Add custom buttons separately
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID().setIdentifier('hangup', 'redirect-connect').toString())
          .setLabel('Connect to a Hub')
          .setStyle(ButtonStyle.Primary)
          .setEmoji(ctx.getEmoji('connect')),
        new ButtonBuilder()
          .setCustomId(new CustomID().setIdentifier('hangup', 'redirect-create').toString())
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

  @RegisterInteractionHandler('hangup', 'redirect-connect')
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

  @RegisterInteractionHandler('hangup', 'redirect-create')
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

  @RegisterInteractionHandler('hangup', 'new-call')
  async handleNewCallButton(ctx: ComponentContext) {
    if (!ctx.inGuild() || !ctx.interaction.channel?.isTextBased()) {
      return;
    }

    // Since we've already checked inGuild(), we know we're in a guild
    // Now we need to ensure the channel is a text-based channel in a guild
    const channel = ctx.interaction.channel;

    // Check if this is a guild channel (has guildId)
    if (!('guildId' in channel)) {
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} This command can only be used in a server text channel.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    await ctx.deferUpdate();

    const callService = new CallService(ctx.client);
    const result = await callService.initiateCall(
      channel as GuildTextBasedChannel,
      ctx.user.id,
    );

    const ui = new UIComponents(ctx.client);

    // Add beta notice and hub promotion at the top
    const container = new ContainerBuilder();

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
        container.addTextDisplayComponents(
          ui.createHeader(
            'Call Initiated',
            'Waiting for another server • Use </hangup:1350402702760218624> to cancel • Follow our [guidelines](https://interchat.tech/guidelines)',
            'call_icon',
          ),
        );

        // Add cancel button
        ui.createActionButtons(
          container,
          {
            label: 'Cancel Call',
            customId: new CustomID().setIdentifier('call', 'cancel').toString(),
            emoji: 'hangup_icon',
          },
        );

        await ctx.editReply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        });
      }
      else {
        // Connected immediately
        container.addTextDisplayComponents(
          ui.createHeader(
            'Call Connected!',
            'You\'ve been connected to another server • Use `/hangup` to end • `/skip` to find another server',
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
            label: 'Skip Server',
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
      container.addTextDisplayComponents(
        ui.createHeader(
          'Call Failed',
          result.message,
          'x_icon',
        ),
      );

      // Add explore hubs button
      ui.createActionButtons(
        container,
        {
          label: 'Explore Hubs',
          customId: new CustomID().setIdentifier('hangup', 'explore-hubs').toString(),
          emoji: 'house_icon',
        },
      );

      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }
}
