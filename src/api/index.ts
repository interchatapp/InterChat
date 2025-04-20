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

import { serve } from '@hono/node-server';
import type { ClusterManager } from 'discord-hybrid-sharding';
import {
  Collection,
  WebhookClient,
} from 'discord.js';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { errorHandler } from '#src/api/middleware/error-handler.js';
import { validateBody } from '#src/api/middleware/validation.js';
import { reactionsUpdateSchema } from '#src/api/schemas/reactions.js';
import { toWebhookPayload, votePayloadSchema } from '#src/api/schemas/vote.js';
import { webhookMessageSchema, webhookSchema } from '#src/api/schemas/webhook.js';
import { VoteManager } from '#src/managers/VoteManager.js';
import type MainMetricsService from '#src/services/MainMetricsService.js';
import Constants from '#src/utils/Constants.js';
import { handleError } from '#src/utils/Utils.js';
import { findOriginalMessage } from '#src/utils/network/messageUtils.js';
import {
  storeReactions,
  updateReactions,
} from '#src/utils/reaction/reactions.js';
import Logger from '#utils/Logger.js';

export const webhookMap = new Collection<string, WebhookClient>();

export const startApi = (
  metrics: MainMetricsService,
  clusterManager?: ClusterManager,
) => {
  const app = new Hono({});
  const voteManager = new VoteManager();

  // Apply global middleware
  app.use('*', errorHandler);

  if (clusterManager) {
    voteManager.setClusterManager(clusterManager);
  }

  app.get('/', (c) => c.redirect(Constants.Links.Website));

  app.post('/dbl', async (c) => {
    const dblHeader = c.req.header('Authorization');
    if (dblHeader !== process.env.TOPGG_WEBHOOK_SECRET) {
      throw new HTTPException(401, { message: 'Unauthorized' });
    }

    const payload = await c.req.json();

    // Validate the payload against our schema
    const result = votePayloadSchema.safeParse(payload);
    if (!result.success) {
      Logger.error(
        'Invalid payload received from top.gg, possible untrusted request: %O',
        payload,
      );
      throw new HTTPException(400, {
        message: 'Invalid payload',
        cause: result.error,
      });
    }

    // Convert the validated payload to the WebhookPayload type
    const webhookPayload = toWebhookPayload(result.data);

    if (webhookPayload.type === 'upvote') {
      await voteManager.incrementUserVote(webhookPayload.user);
      await voteManager.addVoterRole(webhookPayload.user);
    }

    await voteManager.announceVote(webhookPayload);

    // Send DM to the user who voted
    await voteManager.sendVoteDM(webhookPayload);

    return c.body(null, 204);
  });

  // Use the imported webhook schema

  app.post('/webhook', validateBody(webhookSchema), async (c) => {
    const body = c.req.valid('json');

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
      throw new HTTPException(500, {
        message: 'Failed to send webhook message',
        cause: err,
      });
    }
  });

  // Use the imported webhook message schema

  app.post('/webhook/message', validateBody(webhookMessageSchema), async (c) => {
    const body = c.req.valid('json');

    let client = webhookMap.get(body.webhookUrl);
    if (!client) {
      client = new WebhookClient({ url: body.webhookUrl });
      webhookMap.set(body.webhookUrl, client);
    }

    try {
      if (body.action === 'fetch') {
        // Fetch the message
        const message = await client
          .fetchMessage(body.messageId, {
            threadId: body.threadId,
          })
          .catch(() => null);

        return c.json({ data: message });
      }

      if (body.action === 'edit') {
        // Edit the message
        const message = await client
          .editMessage(body.messageId, {
            ...body.data,
            threadId: body.threadId,
          })
          .catch(() => null);

        return c.json({ data: message });
      }

      throw new HTTPException(400, { message: 'Invalid action' });
    }
    catch (err) {
      handleError(err, { comment: `Failed to ${body.action} webhook message` });
      throw new HTTPException(500, {
        message: `Failed to ${body.action} webhook message`,
        cause: err,
      });
    }
  });

  // Use the imported reactions schema

  app.post('/reactions', validateBody(reactionsUpdateSchema), async (c) => {
    try {
      const { messageId, reactions } = c.req.valid('json');

      // Find the original message
      const originalMessage = await findOriginalMessage(messageId);
      if (!originalMessage) {
        throw new HTTPException(404, { message: 'Message not found' });
      }

      // Store the updated reactions in Redis
      await storeReactions(originalMessage, reactions);

      // Update all broadcast messages with the new reactions
      await updateReactions(originalMessage, reactions);

      return c.json({ success: true });
    }
    catch (err) {
      handleError(err, { comment: 'Failed to update reactions' });
      throw new HTTPException(500, {
        message: 'Failed to update reactions',
        cause: err,
      });
    }
  });

  metrics.setupMetricsEndpoint(app);

  app.all('*', (c) => c.redirect(Constants.Links.Website));

  serve({ fetch: app.fetch, port: Number(process.env.PORT || 3000) });
  Logger.info(`API server started on port ${process.env.PORT || 3000}`);
};
