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

import 'source-map-support/register.js';
import { LogLevel, TurboLogger, TurboLoggerConfig } from './TurboLogger.js';

const config: Partial<TurboLoggerConfig> = {
  level: process.env.DEBUG === 'true' ? LogLevel.DEBUG : LogLevel.INFO,
  enableConsole: true,
  enableFileLogging: true,
  enableVisualEnhancements: true,
  logDirectory: 'logs',
};

const Logger = new TurboLogger(config);
export default Logger;
