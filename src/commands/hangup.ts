import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import { CallService } from '#src/services/CallService.js';

export default class HangupCommand extends BaseCommand {
  constructor() {
    super({
      name: 'hangup',
      description: 'End the current call',
      types: { slash: true, prefix: true },
      contexts: { guildOnly: true },
    });
  }

  async execute(ctx: Context) {
    const callService = new CallService(ctx.client);
    const result = await callService.hangup(ctx.channelId);

    await ctx.reply({
      content: result.message,
      components: result.components,
      flags: !result.success ? ['Ephemeral'] : [],
    });
  }
}
