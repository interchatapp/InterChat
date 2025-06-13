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

import { getEmoji } from '#src/utils/EmojiUtils.js';
import getRedis from '#src/utils/Redis.js';
import { handleError } from '#src/utils/Utils.js';
import { RedisKeys } from '#utils/Constants.js';
import db from '#utils/Db.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import type { HubLogConfig, Prisma } from '#src/generated/prisma/client/client.js';
import { stripIndents } from 'common-tags';
import {
  type Client,
  roleMention,
} from 'discord.js';

export type RoleIdLogConfigs = 'appeals' | 'reports' | 'networkAlerts' | 'messageModeration';
export type LogConfigTypes = 'modLogs' | 'joinLeaves' | 'appeals' | 'reports' | 'networkAlerts' | 'messageModeration';
export const logsWithRoleId = ['appeals', 'reports', 'networkAlerts', 'messageModeration'];

export default class HubLogManager {
  public readonly hubId: string;
  private logConfig: HubLogConfig;
  readonly logsWithRoleId = logsWithRoleId;
  readonly logTypes: LogConfigTypes[];

  constructor(logConfig: HubLogConfig) {
    this.hubId = logConfig.hubId;
    this.logConfig = logConfig;
    this.logTypes = [
      'modLogs',
      'joinLeaves',
      'appeals',
      'reports',
      'networkAlerts',
      'messageModeration',
    ] as LogConfigTypes[];
  }

  static async create(hubId: string) {
    const logConfigCache = await getRedis().get(
      `${RedisKeys.hubLogConfig}:${hubId}`,
    );
    const logConfig = logConfigCache
      ? JSON.parse(logConfigCache)
      : await db.hubLogConfig.upsert({
        where: { hubId },
        create: { hubId },
        update: { hubId },
      });

    return new HubLogManager(logConfig as HubLogConfig);
  }

  get config() {
    return this.logConfig;
  }

  async fetchConfig() {
    const config = await db.hubLogConfig.findUnique({
      where: { hubId: this.hubId },
    });
    this.logConfig = config || ({} as HubLogConfig);
    this.refreshCache();

    return this.logConfig;
  }

  async deleteAll() {
    await db.hubLogConfig.delete({ where: { hubId: this.hubId } });
    this.logConfig = {} as HubLogConfig;
    this.refreshCache();
  }

  protected async updateLogConfig(data: Prisma.HubLogConfigUpdateInput) {
    const updated = await db.hubLogConfig.update({
      where: { hubId: this.hubId },
      data,
    });

    this.logConfig = updated;
    this.refreshCache();
  }

  private async refreshCache() {
    try {
      await getRedis().set(
        `${RedisKeys.hubLogConfig}:${this.hubId}`,
        JSON.stringify(this.logConfig),
      );
    }
    catch (error) {
      handleError(error, {
        comment: 'Failed to refresh cache for hub log config',
      });
    }
  }

  async setLogChannel(type: LogConfigTypes, channelId: string) {
    await this.updateLogConfig({
      [`${type}ChannelId`]: channelId,
    });
  }

  async resetLog(...type: LogConfigTypes[]) {
    await this.updateLogConfig(
      type.reduce(
        (acc, typ) => Object.assign(acc, {
          [`${typ}ChannelId`]: null,
          [`${typ}RoleId`]: null,
        }),
        {},
      ),
    );
  }

  async setRoleId(type: RoleIdLogConfigs, roleId: string) {
    const channelIdField = `${type}ChannelId` as const;
    if (!this.config[channelIdField]) throw new Error('Channel ID must be set before setting role ID.');

    await this.updateLogConfig({
      [`${type}RoleId`]: roleId,
    });
  }

  async removeRoleId(type: RoleIdLogConfigs) {
    const channelIdField = `${type}ChannelId` as const;
    if (!this.config[channelIdField]) {
      await this.resetLog(type);
      return;
    }

    await this.updateLogConfig({
      [`${type}RoleId`]: null,
    });
  }

  async setChannelAndRole(
    type: LogConfigTypes,
    channelId: string,
    roleId: string,
  ) {
    if (!this.logsWithRoleId.includes(type)) return;

    await this.setLogChannel(type, channelId);
    await this.setRoleId(type as RoleIdLogConfigs, roleId);
  }

  public getEmbed(client: Client, locale: supportedLocaleCodes = 'en') {
    const channelStr = t('hub.manage.logs.config.fields.channel', locale);
    const roleStr = t('hub.manage.logs.config.fields.role', locale);

    const divider = getEmoji('divider', client);
    const dividerEnd = getEmoji('dividerEnd', client);
    const x_icon = getEmoji('x_icon', client);

    const logDesc = this.logTypes
      .map((type) => {
        const channelIdField = `${type}ChannelId` as const;
        const roleIdField = `${type}RoleId` as const;

        const channelId = this.config[channelIdField];
        const roleId = this.logsWithRoleId.includes(type) ? this.config[roleIdField] : null;

        const mentionedRole = roleId ? roleMention(roleId) : x_icon;
        const roleInfo = this.logsWithRoleId.includes(type)
          ? `${dividerEnd} ${roleStr} ${mentionedRole}`
          : '';

        return stripIndents`
          ${getEmoji('arrow', client)} \`${type}:\`
          ${divider} ${t(`hub.manage.logs.${type}.description`, locale)}
          ${roleInfo ? divider : dividerEnd} ${channelStr} ${channelId ? `<#${channelId}>` : x_icon}
          ${roleInfo}`;
      })
      .join('\n');

    return new InfoEmbed()
      .removeTitle()
      .setDescription(`## ${t('hub.manage.logs.title', locale)}\n\n${logDesc}`)
      .setThumbnail('https://i.imgur.com/vtn1hjI.png');
  }
}
