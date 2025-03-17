import { EmbedBuilder, User, Client, time } from 'discord.js';
import { getBadges, getVoterBadge, formatBadges } from '#utils/BadgeUtils.js';
import UserDbService from '#src/services/UserDbService.js';
import { ReputationService } from '#src/services/ReputationService.js';
import { getUserLeaderboardRank } from '#src/utils/Leaderboard.js';
import { fetchUserData } from '#src/utils/Utils.js';
import Constants from '#utils/Constants.js';
import db from '#utils/Db.js';

export async function buildProfileEmbed(user: User, client: Client) {
  const userData = await fetchUserData(user.id);
  if (!userData) return null;

  const badges = getBadges(user.id, client);
  const hasVoted = await new UserDbService().userVotedToday(user.id, userData);
  if (hasVoted) badges.push(getVoterBadge(client));

  const reputationService = new ReputationService();
  const reputation = await reputationService.getReputation(user.id, userData);

  return new EmbedBuilder()
    .setDescription(`### @${user.username} ${formatBadges(badges)}`)
    .addFields([
      {
        name: 'Badges',
        value: badges.map((b) => `${b.emoji} ${b.name} - ${b.description}`).join('\n') || 'No badges',
        inline: false,
      },
      {
        name: 'Reputation',
        value: `${reputation >= 0 ? '👍' : '👎'} ${reputation}`,
        inline: true,
      },
      {
        name: 'Leaderboard Rank',
        value: `#${(await getUserLeaderboardRank(user.id)) ?? 'Unranked'}`,
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
}
