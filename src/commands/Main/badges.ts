import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import UserDbService from '#src/services/UserDbService.js';
import { ApplicationCommandOptionType } from 'discord.js';

export default class BadgesCommand extends BaseCommand {
  constructor() {
    super({
      name: 'badges',
      description: '🏅 Configure your badge display preferences',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.Boolean,
          name: 'show',
          description: 'Whether to show or hide your badges in messages',
          required: true,
        },
      ],
    });
  }

  async execute(ctx: Context): Promise<void> {
    await ctx.deferReply({ flags: ['Ephemeral'] });

    const showBadges = ctx.options.getBoolean('show', true);
    await new UserDbService().upsertUser(ctx.user.id, { showBadges, name: ctx.user.username });

    await ctx.replyEmbed(showBadges ? 'badges.shown' : 'badges.hidden', {
      t: { emoji: ctx.getEmoji('tick_icon') },
      flags: ['Ephemeral'],
      edit: true,
    });
  }
}
