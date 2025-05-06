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
import { UIComponents } from '#src/utils/DesignSystem.js';
import { CustomID } from '#utils/CustomID.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  GuildTextBasedChannel,
  MessageFlags,
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

  @RegisterInteractionHandler('hangup', 'new-call')
  async handleNewCallButton(ctx: ComponentContext) {
    if (!ctx.inGuild() || !ctx.originalInteraction.channel?.isTextBased()) {
      return;
    }

    // Since we've already checked inGuild(), we know we're in a guild
    // Now we need to ensure the channel is a text-based channel in a guild
    const channel = ctx.originalInteraction.channel;

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

    if (result.success) {
      // Call was initiated successfully
      if (result.message.includes('queue')) {
        // In queue - waiting for match
        const container = new ContainerBuilder();

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
        const container = new ContainerBuilder();

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
      const container = ui.createErrorMessage('Call Failed', result.message);

      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }
}
