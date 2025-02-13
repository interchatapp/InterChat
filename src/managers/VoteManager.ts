/*
 * Copyright (C) 2025 InterChat
 *
 * InterChat is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * InterChat is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with InterChat.  If not, see <https://www.gnu.org/licenses/>.
 */

import { stripIndents } from 'common-tags';
import {
  type APIGuildMember,
  type APIUser,
  EmbedBuilder,
  REST,
  Routes,
  WebhookClient,
  time,
  userMention,
} from 'discord.js';
import ms from 'ms';
import UserDbService from '#src/services/UserDbService.js';
import Scheduler from '#src/services/SchedulerService.js';
import type { WebhookPayload } from '#types/TopGGPayload.d.ts';
import Constants from '#utils/Constants.js';
import db from '#utils/Db.js';
import Logger from '#utils/Logger.js';
import { getOrdinalSuffix } from '#utils/Utils.js';
import type { Context } from 'hono';
import type { BlankEnv, BlankInput } from 'hono/types';

export class VoteManager {
  private scheduler: Scheduler;
  private readonly userDbManager = new UserDbService();
  private readonly rest = new REST({ version: '10' }).setToken(
    process.env.DISCORD_TOKEN as string,
  );

  constructor(scheduler = new Scheduler()) {
    this.scheduler = scheduler;
    this.scheduler.addRecurringTask(
      'removeVoterRole',
      60 * 60 * 1_000,
      async () => {
        const expiredVotes = await db.userData.findMany({
          where: { lastVoted: { lt: new Date() } },
        });
        for (const vote of expiredVotes) {
          await this.removeVoterRole(vote.id);
        }
      },
    );
  }

  async handleVote(c: Context<BlankEnv, '/dbl', BlankInput>) {
    const dblHeader = c.req.header('Authorization');
    if (dblHeader !== process.env.TOPGG_WEBHOOK_SECRET) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    const payload = await c.req.json();

    if (!this.isValidVotePayload(payload)) {
      Logger.error(
        'Invalid payload received from top.gg, possible untrusted request: %O',
        payload,
      );
      return c.json({ message: 'Invalid payload' }, 400);
    }

    if (payload.type === 'upvote') {
      await this.incrementUserVote(payload.user);
      await this.addVoterRole(payload.user);
    }

    await this.announceVote(payload);

    return c.status(204);
  }

  async getUserVoteCount(id: string) {
    const user = await this.userDbManager.getUser(id);
    return user?.voteCount ?? 0;
  }

  async incrementUserVote(userId: string, username?: string) {
    const lastVoted = new Date();
    const user = await this.userDbManager.getUser(userId);
    return await this.userDbManager.upsertUser(userId, {
      username,
      lastVoted,
      voteCount: user?.voteCount ? user.voteCount + 1 : 1,
    });
  }

  async getAPIUser(userId: string) {
    const user = await this.rest.get(Routes.user(userId)).catch(() => null);
    return user as APIUser | null;
  }

  async getUsername(userId: string) {
    const user =
			(await this.getAPIUser(userId)) ??
			(await this.userDbManager.getUser(userId));
    return user?.username ?? 'Unknown User';
  }

  async announceVote(vote: WebhookPayload) {
    const voteCount = (await this.getUserVoteCount(vote.user)) + 1;
    const webhook = new WebhookClient({
      url: String(process.env.VOTE_WEBHOOK_URL),
    });
    const ordinalSuffix = getOrdinalSuffix(voteCount);
    const userMentionStr = userMention(vote.user);
    const username = await this.getUsername(vote.user);

    const isTestVote = vote.type === 'test';
    const timeUntilNextVote = time(
      new Date(Date.now() + (ms('12h') ?? 0)),
      'R',
    );

    await webhook.send({
      content: `${userMentionStr} (**${username}**)`,
      embeds: [
        new EmbedBuilder()
          .setDescription(
            stripIndents`              
            <:topgg_ico_sparkles:1026877534563991562> ${username} just voted! Thank you for the support. Vote again on [top.gg](${Constants.Links.Vote}) ${timeUntilNextVote}!

            -# ${isTestVote ? '⚠️ This is a test vote.' : `🎉 This is your **${voteCount}${ordinalSuffix}** time voting!`}
            `,
          )
          .setColor('#FB3265'),
      ],
    });
  }

  async modifyUserRole(
    type: 'add' | 'remove',
    { userId, roleId }: { userId: string; roleId: string },
  ) {
    const userInGuild = (await this.rest
      .get(Routes.guildMember(Constants.SupportServerId, userId))
      .catch(() => null)) as APIGuildMember | null;

    if (!userInGuild?.roles.includes(roleId)) return;

    const method = type === 'add' ? 'put' : 'delete';
    await this.rest[method](
      Routes.guildMemberRole(Constants.SupportServerId, userId, roleId),
    );
    return;
  }

  async addVoterRole(userId: string) {
    await this.modifyUserRole('add', { userId, roleId: Constants.VoterRoleId });
  }
  async removeVoterRole(userId: string) {
    await this.modifyUserRole('remove', {
      userId,
      roleId: Constants.VoterRoleId,
    });
  }

  private isValidVotePayload(payload: WebhookPayload) {
    const payloadTypes = ['upvote', 'test'];
    const isValidData =
			typeof payload.user === 'string' &&
			typeof payload.bot === 'string' &&
			payloadTypes.includes(payload.type);

    const isValidWeekendType =
			typeof payload.isWeekend === 'boolean' ||
			typeof payload.isWeekend === 'undefined';

    return isValidData && isValidWeekendType;
  }
}
