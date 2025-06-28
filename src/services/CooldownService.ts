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

import { RedisKeys } from '#utils/Constants.js';
import { getRedis } from '#utils/Redis.js';

/** Manage and store individual cooldowns */
export default class CooldownService {
  private readonly redisClient = getRedis();
  private readonly prefix = RedisKeys.cooldown;

  private getKey(id: string) {
    return `${this.prefix}:${id}`;
  }
  /**
   * Set a cooldown
   * @param id A unique id for the cooldown. Eg. <command name>:<user id>
   * @param ms The duration of the cooldown in milliseconds
   */
  public async setCooldown(id: string, ms: number) {
    await this.redisClient.set(this.getKey(id), Date.now() + ms, 'PX', ms);
  }

  /** Get a cooldown */
  public async getCooldown(id: string) {
    return Number.parseInt((await this.redisClient.get(this.getKey(id))) || '0');
  }

  /** Delete a cooldown */
  public async deleteCooldown(id: string) {
    await this.redisClient.del(this.getKey(id));
  }

  /** Get the remaining cooldown in milliseconds */
  public async getRemainingCooldown(id: string) {
    const cooldown = await this.getCooldown(id);
    return cooldown ? cooldown - Date.now() : 0;
  }
}
