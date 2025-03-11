import InfractionManager from '#src/managers/InfractionManager.js';
import { logWarn } from '#src/utils/hub/logger/Warns.js';
import { type Client } from 'discord.js';

interface WarnUserOptions {
  userId: string;
  hubId: string;
  reason: string;
  moderatorId: string;
  client: Client;
}

export async function warnUser({ userId, hubId, reason, moderatorId, client }: WarnUserOptions) {
  const infractionManager = new InfractionManager('user', userId);

  // Create warning infraction
  await infractionManager.addInfraction('WARNING', {
    hubId,
    reason,
    moderatorId,
    expiresAt: null,
  });

  // Log the warning
  const [moderator, warnedUser] = await Promise.all([
    client.users.fetch(moderatorId),
    client.users.fetch(userId),
  ]);

  await logWarn(hubId, {
    warnedUser,
    moderator,
    reason,
  });
}
