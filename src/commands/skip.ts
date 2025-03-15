import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import { CallService } from '#src/services/CallService.js';

export default class SkipCommand extends BaseCommand {
  constructor() {
    super({
      name: 'skip',
      description: 'Skip the current call and find a new match',
      types: { slash: true, prefix: true },
      contexts: { guildOnly: true },
    });
  }

  async execute(ctx: Context) {
    const callService = new CallService(ctx.client);
    const result = await callService.skip(ctx.channelId);

    await ctx.reply({
      content: result.message,
      flags: !result.success ? ['Ephemeral'] : [],
    });
  }
}
