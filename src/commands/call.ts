import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import { CallService } from '#src/services/CallService.js';
import { GuildTextBasedChannel } from 'discord.js';

export default class CallCommand extends BaseCommand {
  constructor() {
    super({
      name: 'call',
      description: 'Start a call with another server',
      types: { slash: true, prefix: true },
      contexts: { guildOnly: true },
    });
  }

  async execute(ctx: Context) {
    await ctx.deferReply();

    const callService = new CallService(ctx.client);
    const result = await callService.initiateCall(
      ctx.channel as GuildTextBasedChannel,
      ctx.user.id,
    );

    await ctx.editOrReply(result.message);
  }
}
