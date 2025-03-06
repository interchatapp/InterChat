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

import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const template = fs.readFileSync('prometheus-template.yml', 'utf8');

const config = template
  .replace('${GRAFANA_CLOUD_URL}', process.env.GRAFANA_CLOUD_URL)
  .replace('${GRAFANA_CLOUD_USERNAME}', process.env.GRAFANA_CLOUD_USERNAME)
  .replace('${GRAFANA_CLOUD_API_KEY}', process.env.GRAFANA_CLOUD_API_KEY)
  .replace('${PORT}', process.env.PORT);

fs.writeFileSync('prometheus.yml', config);
