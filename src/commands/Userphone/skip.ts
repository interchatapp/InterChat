import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import { CallService } from '#src/services/CallService.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { CustomID } from '#utils/CustomID.js';
import { stripIndents } from 'common-tags';
import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
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

        // Add beta notice and hub promotion at the top
        container.addTextDisplayComponents(
          ui.createSubsection(
            '🌟 Discover InterChat Hubs!',
            'Calls are in beta. For a more reliable experience, try InterChat Hubs - our main feature for connecting servers!',
            'info_icon',
          ),
        );

        container.addTextDisplayComponents(
          ui.createHeader(
            'Finding New Call',
            'Previous call ended • Waiting for another server • Use `/hangup` to cancel',
            'call_icon',
          ),
        );

        // Add buttons
        container.addActionRowComponents((row) =>
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(new CustomID().setIdentifier('call', 'cancel').toString())
              .setLabel('Cancel Call')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('📞'),
            new ButtonBuilder()
              .setCustomId(new CustomID().setIdentifier('call', 'explore-hubs').toString())
              .setLabel('Explore Hubs')
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

        // Add beta notice and hub promotion at the top
        container.addTextDisplayComponents(
          ui.createSubsection(
            '🌟 Discover InterChat Hubs!',
            'Calls are in beta. For a more reliable experience, try InterChat Hubs - our main feature for connecting servers!',
            'info_icon',
          ),
        );

        container.addTextDisplayComponents(
          ui.createHeader(
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
              .setLabel('End Call')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('📞'),
            new ButtonBuilder()
              .setCustomId(new CustomID().setIdentifier('call', 'skip').toString())
              .setLabel('Skip Again')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('⏭️'),
            new ButtonBuilder()
              .setCustomId(new CustomID().setIdentifier('call', 'explore-hubs').toString())
              .setLabel('Explore Hubs')
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
      const container = new ContainerBuilder();

      container.addTextDisplayComponents(
        ui.createHeader(
          'Skip Failed',
          result.message,
          'x_icon',
        ),
      );

      // Add hub promotion
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          stripIndents`
          ### Try InterChat Hubs Instead!
          Hubs are our main feature - persistent communities that connect multiple servers together.
          Unlike calls, hubs stay connected 24/7 and offer more features.
          `,
        ),
      );

      // Add explore hubs button
      container.addActionRowComponents((row) =>
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(new CustomID().setIdentifier('call', 'explore-hubs').toString())
            .setLabel('Explore Hubs')
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
