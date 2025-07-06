import { Badges } from '#src/generated/prisma/client/index.js';
import db from '#src/utils/Db.js';
import Logger from '#src/utils/Logger.js';

export default async function removeExpiredSupporterBadges() {
  Logger.info('Running cron job to remove expired supporter badges...');
  const expiredUsers = await db.user.findMany({
    where: {
      donationExpiresAt: {
        lt: new Date(),
      },
      badges: {
        has: Badges.SUPPORTER,
      },
    },
  });

  for (const user of expiredUsers) {
    await db.user.update({
      where: { id: user.id },
      data: {
        badges: {
          set: user.badges.filter((b) => b !== Badges.SUPPORTER),
        },
        donationTier: null,
        donationExpiresAt: null,
      },
    });
    Logger.info(`Removed supporter badge from user ${user.id}`);
  }
}
