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

import type BaseCommand from '#src/core/BaseCommand.js';
import type { InteractionFunction } from '#src/decorators/RegisterInteractionHandler.js';
import AntiSpamManager from '#src/managers/AntiSpamManager.js';
import EventLoader from '#src/modules/Loaders/EventLoader.js';
import CooldownService from '#src/services/CooldownService.js';
import Scheduler from '#src/services/SchedulerService.js';
import { loadInteractions } from '#src/utils/CommandUtils.js';
import { loadCommands } from '#src/utils/Loaders.js';
import Logger from '#src/utils/Logger.js';
import type { RemoveMethods } from '#types/CustomClientProps.d.ts';
import Constants from '#utils/Constants.js';
import { loadLocales } from '#utils/Locale.js';
import { resolveEval } from '#utils/Utils.js';
import { ClusterClient, getInfo } from 'discord-hybrid-sharding';
import {
  Client,
  Collection,
  GatewayIntentBits,
  type Guild,
  Options,
  type Snowflake,
  Sweepers,
} from 'discord.js';

export default class InterChatClient extends Client {
  static instance: InterChatClient;

  private readonly scheduler = new Scheduler();

  public readonly commands = new Collection<string, BaseCommand>();
  public readonly interactions = new Collection<string, InteractionFunction>();

  public readonly version = Constants.ProjectVersion;
  public readonly reactionCooldowns = new Collection<string, number>();
  public readonly cluster = new ClusterClient(this);
  public readonly eventLoader = new EventLoader(this);
  public readonly commandCooldowns = new CooldownService();
  public readonly antiSpamManager = new AntiSpamManager({
    spamThreshold: 4,
    timeWindow: 3000,
    spamCountExpirySecs: 60,
  });

  constructor() {
    super({
      shards: getInfo().SHARD_LIST, // An array of shards that will get spawned
      shardCount: getInfo().TOTAL_SHARDS, // Total number of shards
      makeCache: Options.cacheWithLimits({
        ThreadManager: {
          maxSize: 1000,
        },
        ReactionManager: 200,
        PresenceManager: 0,
        AutoModerationRuleManager: 0,
        VoiceStateManager: 0,
        GuildScheduledEventManager: 0,
        ApplicationCommandManager: 0,
        BaseGuildEmojiManager: 0,
        StageInstanceManager: 0,
        ThreadMemberManager: 0,
        GuildInviteManager: 0,
        GuildEmojiManager: 0,
        GuildBanManager: 0,
        DMMessageManager: 0,
      }),
      sweepers: {
        messages: {
          interval: 1800, // 30 minutes
          filter: Sweepers.filterByLifetime({
            lifetime: 7200, // 2 hours
            getComparisonTimestamp: (message) => message.createdTimestamp,
          }),
        },
        threads: {
          interval: 60,
          filter: () => (thread) => Boolean(thread.archived || thread.locked),
        },
      },
      intents: [
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildWebhooks,
      ],
      allowedMentions: { repliedUser: false },
    });
  }

  async start() {
    // initialize the client
    InterChatClient.instance = this;

    // load commands, interactions and event handlers to memory
    this.loadResoruces();

    // Discord.js automatically uses DISCORD_TOKEN env variable
    await this.login();
  }

  async loadResoruces() {
    // initialize i18n for localization
    loadLocales('locales');

    await loadCommands(this.commands, this.interactions);
    Logger.info(`Loaded ${this.commands.size} commands`);

    await loadInteractions(this.interactions);
    Logger.info(`Loaded ${this.interactions.size} interactions`);

    this.eventLoader.load();
  }

  /**
	 * Fetches a guild by its ID from the cache of one of the clusters.
	 * @param guildId The ID of the guild to fetch.
	 * @returns The fetched guild **without any methods**, or undefined if the guild is not found.
	 */
  async fetchGuild(
    guildId: Snowflake,
  ): Promise<RemoveMethods<Guild> | undefined> {
    const fetch = (await this.cluster.broadcastEval(
      (client, guildID) => client.guilds.cache.get(guildID),
      { guildId, context: guildId },
    )) as Guild[];

    return fetch ? resolveEval(fetch) : undefined;
  }

  getScheduler(): Scheduler {
    return this.scheduler;
  }
}
