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
import type BasePrefixCommand from '#src/core/BasePrefixCommand.js';
import type { InteractionFunction } from '#src/decorators/RegisterInteractionHandler.js';
import type AntiSpamManager from '#src/managers/AntiSpamManager.js';
import type EventLoader from '#src/modules/Loaders/EventLoader.js';
import type CooldownService from '#src/services/CooldownService.js';
import type Scheduler from '#src/services/SchedulerService.js';
import { ShardMetricsService } from '#src/services/ShardMetricsService.js';
import type { ClusterClient } from 'discord-hybrid-sharding';
import type {
  Collection,
  ForumChannel,
  MediaChannel,
  NewsChannel,
  Snowflake,
  TextChannel,
} from 'discord.js';

export type RemoveMethods<T> = {
  [K in keyof T]: T[K] extends (...args: unknown[]) => unknown ? never : RemoveMethods<T[K]>;
};

export type ThreadParentChannel = NewsChannel | TextChannel | ForumChannel | MediaChannel;

declare module 'discord.js' {
  export interface Client {
    readonly version: string;
    readonly development: boolean;
    readonly description: string;
    readonly commands: Collection<string, BaseCommand>;
    readonly interactions: Collection<string, InteractionFunction>;
    readonly prefixCommands: Collection<string, BasePrefixCommand>;

    readonly eventLoader: EventLoader;
    readonly aliases: Collection<string, string>

    readonly commandCooldowns: CooldownService;
    readonly reactionCooldowns: Collection<string, number>;
    readonly cluster: ClusterClient<Client>;
    readonly antiSpamManager: AntiSpamManager;

    readonly shardMetrics: ShardMetricsService;

    fetchGuild(guildId: Snowflake): Promise<RemoveMethods<Guild> | undefined>;
    getScheduler(): Scheduler;
  }
}
