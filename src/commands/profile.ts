import BaseCommand from '#src/core/BaseCommand.js';
import Context from '#src/core/CommandContext/Context.js';
import Constants from '#src/utils/Constants.js';
import db from '#src/utils/Db.js';
import { getUserLeaderboardRank } from '#src/utils/Leaderboard.js';
import { fetchUserData } from '#src/utils/Utils.js';
import { ApplicationCommandOptionType, EmbedBuilder, time } from 'discord.js';
export default class ProfileCommand extends BaseCommand {
  constructor() {
    super({
      name: 'profile',
      description: 'View your profile or someone else\'s InterChat profile.',
      types: { slash: true, prefix: true },
      options: [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'The user to view the profile of.',
          required: false,
        },
      ],
    });
  }
  async execute(ctx: Context) {
    const user = (await ctx.options.getUser('user')) ?? ctx.user;
    const userData = await fetchUserData(user.id);

    if (!userData) {
      await ctx.reply('User not found.');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`@${user.username}`)
      .addFields([
        {
          name: 'Leaderboard Rank',
          value: `#${(await getUserLeaderboardRank(user.id)) ?? 'Unranked.'}`,
          inline: true,
        },
        {
          name: 'Total Messages',
          value: `${userData.messageCount}`,
          inline: true,
        },
        {
          name: 'User Since',
          value: `${time(Math.round(userData.createdAt.getTime() / 1000), 'D')}`,
          inline: true,
        },
        {
          name: 'Hubs Owned',
          value: `${(await db.hub.findMany({ where: { ownerId: user.id, private: false } })).map((h) => h.name).join(', ')}`,
          inline: true,
        },
        {
          name: 'User ID',
          value: user.id,
          inline: true,
        },
      ])
      .setColor(Constants.Colors.invisible)
      .setThumbnail(user.displayAvatarURL());

    await ctx.reply({ embeds: [embed] });
  }
}
