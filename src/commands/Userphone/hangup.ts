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

import Constants from '#src/utils/Constants.js';
import { createCallRatingRow } from '#src/utils/ComponentUtils.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { t } from '#src/utils/Locale.js';
import { CustomID } from '#utils/CustomID.js';
import { stripIndents } from 'common-tags';
import {
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
      aliases: ['h'],
      examples: ['.hangup', '.h'],
      types: { slash: true, prefix: true },
      contexts: { guildOnly: true },
    });
  }

  async execute(ctx: Context) {
    if (!ctx.inGuild() || !ctx.channelId) return;

    const distributedCallingLibrary = ctx.client.getDistributedCallingLibrary();
    if (!distributedCallingLibrary) {
      // Fast error response without locale lookup
      const ui = new UIComponents(ctx.client);
      const container = ui.createCompactErrorMessage(
        'Call Failed',
        'Call system is currently unavailable. Please try again later.',
      );
      await ctx.reply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    // Parallel execution for performance
    const [result, locale] = await Promise.all([
      distributedCallingLibrary.hangupCall(ctx.channelId),
      ctx.getLocale(),
    ]);

    const ui = new UIComponents(ctx.client);

    if (result.success) {
      // Check if this was a queue exit or an active call end
      if (result.message.includes('queue')) {
        // Was in queue, not in active call
        const container = ui.createCompactSuccessMessage(
          t('calls.cancelled.title', locale),
          t('calls.cancelled.queueExit', locale),
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

        await ctx.reply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        });
      }
      else {
        // Create combined rating and report UI
        const ratingRow = createCallRatingRow(result.callId || '', locale);

        // Create success message
        const container = ui.createCompactSuccessMessage(
          t('calls.ended.title', locale),
          t('calls.ended.description', locale),
        );

        // Add small hub promotion
        container.addSectionComponents((s) =>
          s
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                '💡 **Tip:** Try InterChat Hubs for a more reliable experience!',
              ),
            )
            .setButtonAccessory(
              new ButtonBuilder()
                .setCustomId(new CustomID().setIdentifier('hangup', 'explore-hubs').toString())
                .setLabel(t('calls.buttons.exploreHubs', locale))
                .setStyle(ButtonStyle.Primary)
                .setEmoji(ctx.getEmoji('house_icon')),
            ),
        );

        // Add hub and call buttons
        container.addActionRowComponents((row) =>
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(new CustomID().setIdentifier('hangup', 'new-call').toString())
              .setLabel(t('calls.buttons.newCall', locale))
              .setStyle(ButtonStyle.Secondary)
              .setEmoji(ctx.getEmoji('call_icon')),
          ),
        );

        await ctx.reply({
          components: [container, ratingRow],
          flags: [MessageFlags.IsComponentsV2],
        });
      }
    }
    else {
      // Error occurred
      const container = ui.createCompactErrorMessage(
        t('hangup.errors.error', locale),
        result.message,
      );

      await ctx.reply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }

  @RegisterInteractionHandler('hangup', 'explore-hubs')
  async handleExploreHubsButton(ctx: ComponentContext) {
    const locale = await ctx.getLocale();

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
    ui.createActionButtons(container, {
      label: 'Browse All Hubs',
      url: `${Constants.Links.Website}/hubs`,
      emoji: 'globe_icon',
    });

    // Add custom buttons separately
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID().setIdentifier('hangup', 'redirect-connect').toString())
          .setLabel(t('global.buttons.connectToHub', locale))
          .setStyle(ButtonStyle.Primary)
          .setEmoji(ctx.getEmoji('connect')),
      ),
    );

    await ctx.reply({
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
      const locale = await ctx.getLocale();
      await ctx.reply({
        content: t('hangup.errors.connectNotFound', locale, {
          emoji: ctx.getEmoji('x_icon'),
        }),
        flags: ['Ephemeral'],
      });
    }
  }

  @RegisterInteractionHandler('hangup', 'new-call')
  async handleNewCallButton(ctx: ComponentContext) {
    if (!ctx.inGuild() || !ctx.interaction.channel?.isTextBased()) {
      return;
    }

    const channel = ctx.interaction.channel;

    // Check if this is a guild channel (has guildId)
    if (!('guildId' in channel)) {
      // Fast error response without locale lookup
      await ctx.reply({
        content: `${getEmoji('x_icon', ctx.client)} This command can only be used in server channels.`,
        flags: ['Ephemeral'],
      });
      return;
    }

    await ctx.deferUpdate();

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
      distributedCallingLibrary.initiateCall(
        channel as GuildTextBasedChannel,
        ctx.user.id,
      ),
      ctx.getLocale(),
    ]);

    if (result.success) {
      // Call was initiated successfully
      if (result.message.includes('queue')) {
        await ctx.editReply(t('calls.waiting.description', locale));
      }
      else {
        await ctx.editReply(t('calls.connected.title', locale));
      }
    }
    else {
      await ctx.editReply(`${t('calls.failed.title', locale)}\n${result.message}`);
    }
  }
}
