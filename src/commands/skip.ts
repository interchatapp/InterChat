import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import { CallService } from '#src/services/CallService.js';

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
    const callService = new CallService(ctx.client);
    // Pass the user ID to ensure proper matching history is maintained
    const result = await callService.skip(ctx.channelId, ctx.user.id);

    await ctx.reply({
      content: result.message,
      flags: !result.success ? ['Ephemeral'] : [],
    });
  }
}
