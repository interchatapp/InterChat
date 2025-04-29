import HubLogManager from '#src/managers/HubLogManager.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { t } from '#src/utils/Locale.js';
import { EmbedBuilder, type User } from 'discord.js';
import { sendLog } from './Default.js';

export const logWarn = async (
  hubId: string,
  opts: {
    warnedUser: User;
    moderator: User;
    reason: string;
  },
) => {
  const logManager = await HubLogManager.create(hubId);
  if (!logManager.config.modLogsChannelId) return;

  const { warnedUser, moderator, reason } = opts;
  const arrow = getEmoji('dot', moderator.client);

  const embed = new EmbedBuilder()
    .setTitle(
      t('warn.log.title', 'en', {
        emoji: getEmoji('exclamation', moderator.client),
      }),
    )
    .setColor('Yellow')
    .setDescription(
      t('warn.log.description', 'en', {
        arrow,
        user: warnedUser.username,
        userId: warnedUser.id,
        moderator: moderator.username,
        modId: moderator.id,
        reason,
      }),
    )
    .setTimestamp()
    .setFooter({
      text: t('warn.log.footer', 'en', {
        moderator: moderator.username,
      }),
      iconURL: moderator.displayAvatarURL(),
    });

  await sendLog(moderator.client.cluster, logManager.config.modLogsChannelId, embed);
};
