import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import { CallService } from '#src/services/CallService.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { stripIndents } from 'common-tags';
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

    await ctx.editOrReply({
      content: result.message,
      embeds: [
        new InfoEmbed().setDescription(stripIndents`
          > This is a new feature! Your patience during these early days helps make calls better! The more you use it, the more active it becomes. Check out \`/leaderboard calls\` to see how you rank!
        `),
      ],
    });
  }
}
