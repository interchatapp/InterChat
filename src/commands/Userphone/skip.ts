import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import { CallService } from '#src/services/CallService.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { t } from '#src/utils/Locale.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import { CustomID } from '#utils/CustomID.js';
import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
} from 'discord.js';

/**
 * Command to skip the current call and find a new match
 * This is a convenience command that combines hangup and call in one step
 */
export default class SkipCommand extends BaseCommand {
  constructor() {
    super({
      name: 'skip',
      description: '[BETA] Skip the current call and find a new match',
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

    const locale = await fetchUserLocale(ctx.user.id);
    const callService = new CallService(ctx.client);
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

    // Pass the user ID to ensure proper matching history is maintained
    const result = await callService.skip(ctx.channelId, ctx.user.id);

    if (result.success) {
      // Call was skipped successfully
      if (result.message.includes('queue')) {
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
            'New Call Connected!',
            'You\'ve been connected to a different server • Use `/hangup` to end',
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
