import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import Ready from '#src/events/guildCreate.js';
import { CustomID } from '#src/utils/CustomID.js';
import { UIComponents } from '#src/utils/DesignSystem.js';
import { stripIndents } from 'common-tags';
import {
  ContainerBuilder,
  TextDisplayBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';

export default class WelcomeButtonsHandler {
  /**
   * Handle the "Setup Calls" button click
   */
  @RegisterInteractionHandler('welcome', 'calls')
  async handleCallsButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Header for calls help
    container.addTextDisplayComponents(
      ui.createHeader(
        '📞 Setup Calls',
        'Learn about InterChat calls - instant server-to-server connections!',
        'call_icon',
      ),
    );

    // Call commands section
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '**Available Call Commands:**\n' +
          '• `/call` - Start a call with another server\n' +
          '• `/skip` - Skip current call and find a new match\n' +
          '• `/hangup` - End the current call\n' +
          '• `/leaderboard calls` - View call leaderboards',
      ),
    );

    // Usage examples
    container.addTextDisplayComponents(
      ui.createSubsection(
        'How to Use Calls',
        '1. Run `/call` in any text channel to start\n' +
          '2. Wait to be matched with another server\n' +
          '3. Chat with the other server in real-time\n' +
          '4. Use `/skip` to find a different server\n' +
          "5. Use `/hangup` when you're done chatting\n\n" +
          '**Note:** Calls are in beta - for a more reliable experience, try InterChat Hubs!',
        'info_icon',
      ),
    );

    // Back button
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID().setIdentifier('welcome', 'back').toString())
          .setLabel('← Back')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(ctx.getEmoji('arrow_left')),
      ),
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Handle the "Setup Hubs" button click
   */
  @RegisterInteractionHandler('welcome', 'setup')
  async handleSetupButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    const ui = new UIComponents(ctx.client);
    const container = new ContainerBuilder();

    // Header for setup help
    container.addTextDisplayComponents(
      ui.createHeader(
        '🏠 Setup Cross-Server Chat',
        'Connect to hubs for persistent cross-server communities!',
        'house_icon',
      ),
    );

    // Setup instructions
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '**Get Started with Hubs:**\n' +
          '• `/setup` - Guided setup to join your first hub\n' +
          '• `/connect` - Connect to a specific hub',
      ),
    );

    // What are hubs section
    container.addTextDisplayComponents(
      ui.createSubsection(
        'What are Hubs?',
        "Hubs are persistent chat communities where multiple servers connect and chat together 24/7. Unlike calls, hub messages stay even when you're offline!",
        'info_icon',
      ),
    );

    // Benefits section
    container.addTextDisplayComponents(
      ui.createSubsection(
        'Why Choose Hubs?',
        stripIndents`
          - Persistent connections that stay active
          - Join multiple themed communities
          - Advanced moderation and filtering
          - Custom welcome messages and rules
          - Thousands of servers already connected`,
        'star_empty',
      ),
    );

    // Action buttons
    container.addActionRowComponents((row) =>
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(new CustomID().setIdentifier('welcome', 'run-setup').toString())
          .setLabel('Run Setup Now')
          .setStyle(ButtonStyle.Primary)
          .setEmoji(ctx.getEmoji('tick_icon')),
        new ButtonBuilder()
          .setCustomId(new CustomID().setIdentifier('welcome', 'back').toString())
          .setLabel('← Back')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(ctx.getEmoji('arrow_left')),
      ),
    );

    await ctx.editReply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2],
    });
  }

  /**
   * Handle the "Run Setup" button click - triggers the setup command
   */
  @RegisterInteractionHandler('welcome', 'run-setup')
  async handleRunSetupButton(ctx: ComponentContext) {
    if (!ctx.inGuild()) {
      await ctx.reply({
        content: 'This command can only be used in a server.',
        flags: ['Ephemeral'],
      });
      return;
    }

    // Get the setup command and execute it
    const setupCommand = ctx.client.commands.get('setup');
    if (setupCommand?.execute) {
      await setupCommand.execute(ctx);
    }
    else {
      await ctx.reply({
        content: `${ctx.getEmoji('x_icon')} Setup command not found. Please try running \`/setup\` manually.`,
        flags: ['Ephemeral'],
      });
    }
  }

  /**
   * Handle the "Back" button click - returns to main welcome message
   */
  @RegisterInteractionHandler('welcome', 'back')
  async handleBackButton(ctx: ComponentContext) {
    await ctx.deferUpdate();

    if (!ctx.guild) return;

    // Recreate the main welcome message
    const welcomeContainer = await Ready.createWelcomeMessage(ctx.guild);

    await ctx.editReply({
      components: [welcomeContainer],
      flags: [MessageFlags.IsComponentsV2],
    });
  }
}
