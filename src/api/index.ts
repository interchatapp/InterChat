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

import { VoteManager } from '#src/managers/VoteManager.js';
import Constants from '#src/utils/Constants.js';
import { handleError } from '#src/utils/Utils.js';
import Logger from '#utils/Logger.js';
import { serve } from '@hono/node-server';
import {
  Collection,
  WebhookClient,
  type WebhookMessageCreateOptions,
} from 'discord.js';
import { Hono } from 'hono';

export const webhookMap = new Collection<string, WebhookClient>();

export const startApi = () => {
  const app = new Hono({});
  const voteManager = new VoteManager();

  app.get('/', (c) => c.redirect(Constants.Links.Website));

  app.post('/dbl', async (c) => {
    await voteManager.middleware(c);
    return c.text('Vote received');
  });

  app.post('/webhook', async (c) => {
    const body = await c.req.json<{
      webhookUrl: string;
      data: WebhookMessageCreateOptions;
    }>();

    let client = webhookMap.get(body.webhookUrl);
    if (!client) {
      client = new WebhookClient({ url: body.webhookUrl });
      webhookMap.set(body.webhookUrl, client);
    }

    try {
      const res = await client.send(body.data);
      return c.json({ data: res });
    }
    catch (err) {
      handleError(err, { comment: 'Failed to send webhook message' });
      return c.json({ data: null, error: err.message }, 500);
    }
  });

  app.all('*', (c) => c.redirect(Constants.Links.Website));

  serve({ fetch: app.fetch, port: Number(process.env.PORT || 3000) });
  Logger.info(`API server started on port ${process.env.PORT || 3000}`);
};
