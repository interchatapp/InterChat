import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';

import { UIComponents } from '#src/utils/DesignSystem.js';
import { t } from '#src/utils/Locale.js';
import { CustomID } from '#utils/CustomID.js';
import { ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags } from 'discord.js';

/**
 * Command to skip the current call and find a new match
 * This is a convenience command that combines hangup and call in one step
 */
export default class SkipCommand extends BaseCommand {
  constructor() {
    super({
      name: 'skip',
      description: '[BETA] Skip the current call and find a new match',
      aliases: ['s'],
      examples: ['i.skip', 'i.s'],
      types: { slash: true, prefix: true },
      contexts: { guildOnly: true },
    });
  }

  /**
   * Execute the skip command
   * This ends the current call and immediately starts looking for a new match
   */
  async execute(ctx: Context) {
    await ctx.deferReply();

    // Use the context's getLocale method which is optimized
    const locale = await ctx.getLocale();
    const ui = new UIComponents(ctx.client);

    // Ensure channelId is not null
    if (!ctx.inGuild()) {
      const container = ui.createCompactErrorMessage(
        t('skip.errors.error', locale),
        t('calls.failed.reasons.channelInvalid', locale),
      );

      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    const distributedCallingLibrary = ctx.client.getDistributedCallingLibrary();
    if (!distributedCallingLibrary) {
      const container = ui.createCompactErrorMessage(
        t('skip.errors.error', locale),
        'Call system is currently unavailable. Please try again later.',
      );
      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    // Pass the user ID to ensure proper matching history is maintained
    const result = await distributedCallingLibrary.skipCall(ctx.channelId, ctx.user.id);

    if (result.success) {
      // Call was skipped successfully
      if (
        result.message.includes('looking for a new match') ||
        result.message.includes('queue') ||
        result.message.includes('Looking for a Match')
      ) {
        // In queue - waiting for match
        const container = new ContainerBuilder();

        container.addTextDisplayComponents(
          ui.createCompactHeader(
            t('calls.skip.title', locale),
            t('calls.skip.description', locale),
            'call_icon',
          ),
        );

        // Add buttons
        container.addActionRowComponents((row) =>
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(new CustomID().setIdentifier('call', 'cancel').toString())
              .setLabel(t('calls.buttons.cancelCall', locale))
              .setStyle(ButtonStyle.Danger)
              .setEmoji('📞'),
            new ButtonBuilder()
              .setCustomId(new CustomID().setIdentifier('call', 'explore-hubs').toString())
              .setLabel(t('calls.buttons.exploreHubs', locale))
              .setStyle(ButtonStyle.Primary)
              .setEmoji('🏠'),
          ),
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
          ui.createCompactHeader(
            t('calls.skip.newConnected.title', locale),
            t('calls.skip.newConnected.description', locale),
            'tick_icon',
          ),
        );

        // Add buttons
        container.addActionRowComponents((row) =>
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(new CustomID().setIdentifier('call', 'hangup').toString())
              .setLabel(t('calls.buttons.endCall', locale))
              .setStyle(ButtonStyle.Danger)
              .setEmoji('📞'),
            new ButtonBuilder()
              .setCustomId(new CustomID().setIdentifier('call', 'skip').toString())
              .setLabel(t('calls.buttons.skipAgain', locale))
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('⏭️'),
            new ButtonBuilder()
              .setCustomId(new CustomID().setIdentifier('call', 'explore-hubs').toString())
              .setLabel(t('calls.buttons.exploreHubs', locale))
              .setStyle(ButtonStyle.Primary)
              .setEmoji('🏠'),
          ),
        );

        await ctx.editReply({
          components: [container],
          flags: [MessageFlags.IsComponentsV2],
        });
      }
    }
    else {
      // Error occurred
      const container = ui.createCompactErrorMessage(
        t('skip.errors.skipFailed', locale),
        result.message,
      );

      // Add explore hubs button
      container.addActionRowComponents((row) =>
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(new CustomID().setIdentifier('call', 'explore-hubs').toString())
            .setLabel(t('calls.buttons.exploreHubs', locale))
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🏠'),
        ),
      );

      await ctx.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2],
      });
    }
  }
}
