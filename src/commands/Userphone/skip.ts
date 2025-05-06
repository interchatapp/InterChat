import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import { CallService } from '#src/services/CallService.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { CustomID } from '#utils/CustomID.js';
import {
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
      description: 'Skip the current call and find a new match',
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

    const callService = new CallService(ctx.client);
    const ui = new UIComponents(ctx.client);

    // Ensure channelId is not null
    if (!ctx.inGuild()) {
      const container = ui.createErrorMessage(
        'Error',
        'Cannot skip call - invalid channel',
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
          ui.createHeader(
            'Finding New Call',
            'Previous call ended • Waiting for another server • Use `/hangup` to cancel',
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
}
