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

import { Redis } from 'ioredis';

const REDIS_CONFIG = {
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  lazyConnect: true,
  keepAlive: 30000,
  connectTimeout: 10000,
  family: 4, // IPv4
  db: 0,
} as const;

// when run using scripts like registerCmds
let redisClient: Redis;

export const getRedis = () => {
  if (!process.env.REDIS_URI) {
    throw new Error('REDIS_URI environment variable is not set');
  }

  if (!redisClient) redisClient = new Redis(process.env.REDIS_URI, REDIS_CONFIG);
  return redisClient;
};

export default getRedis;
