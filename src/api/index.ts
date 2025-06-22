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
import { Collection, WebhookClient } from 'discord.js';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { validateBody } from '#src/api/middleware/validation.js';
import { reactionsUpdateSchema } from '#src/api/schemas/reactions.js';
import { toWebhookPayload, votePayloadSchema } from '#src/api/schemas/vote.js';
import { webhookMessageSchema, webhookSchema } from '#src/api/schemas/webhook.js';
import { VoteManager } from '#src/managers/VoteManager.js';
import type MainMetricsService from '#src/services/MainMetricsService.js';
import Constants from '#src/utils/Constants.js';
import { handleError } from '#src/utils/Utils.js';
import { findOriginalMessage } from '#src/utils/network/messageUtils.js';
import { storeReactions, updateReactions } from '#src/utils/reaction/reactions.js';
import Logger from '#utils/Logger.js';

export const webhookMap = new Collection<string, { lastUsed: Date, client: WebhookClient }>();

setInterval(() => {
  webhookMap.forEach((client, url) => {
    const timeSinceLastUsed = Date.now() - client.lastUsed.getTime();
    const tenMinutes = 10 * 60 * 1000;

    // Remove the webhook from the cache if it hasn't been used in the last 10 minutes
    // This will prevent the webhook cache from growing unbounded
    if (timeSinceLastUsed > tenMinutes) {
      webhookMap.delete(url);
    }
  });
}, 300000);

export const startApi = (metrics: MainMetricsService, clusterManager?: ClusterManager) => {
  const app = new Hono({});
  const voteManager = new VoteManager();

  // Apply global middleware
  app.onError((err, c) => {
    Logger.debug(`[app.onError] Caught error in global error handler: ${err.message}`);

    if (err instanceof HTTPException) {
      const cause = err.cause;
      Logger.debug(`[app.onError] HTTPException caught: ${err.message}, status: ${err.status}`);

      if (cause instanceof ZodError) {
        // Format Zod validation errors
        return c.json(
          {
            message: err.message,
            errors: cause.errors.map((e) => ({
              path: e.path.join('.'),
              message: e.message,
            })),
          },
          err.status,
        );
      }

      return c.json(
        {
          message: err.message,
          ...(cause ? { details: cause } : {}),
        },
        err.status,
      );
    }

    // Handle unexpected errors
    Logger.debug(
      `[app.onError] Unexpected error type: ${err instanceof Error ? err.name : typeof err}`,
    );
    return c.json(
      {
        message: 'Internal Server Error',
      },
      500,
    );
  });

  if (clusterManager) {
    voteManager.setClusterManager(clusterManager);
  }

  app.get('/', (c) => c.redirect(Constants.Links.Website));

  app.post('/dbl', async (c) => {
    try {
      Logger.debug(
        `[dbl] Processing top.gg webhook request from ${c.req.header('X-Forwarded-For')}`,
      );
      const dblHeader = c.req.header('Authorization');
      if (dblHeader !== process.env.TOPGG_WEBHOOK_SECRET) {
        Logger.warn('[dbl] Unauthorized request - invalid webhook secret');
        throw new HTTPException(401, { message: 'Unauthorized' });
      }

      const payload = await c.req.json();
      Logger.debug('[dbl] Received payload from top.gg');

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
      Logger.debug(
        `[dbl] Processing vote of type: ${webhookPayload.type} from user: ${webhookPayload.user}`,
      );

      if (webhookPayload.type === 'upvote') {
        Logger.debug(`[dbl] Incrementing vote count for user: ${webhookPayload.user}`);
        await voteManager.incrementUserVote(webhookPayload.user);
        Logger.debug(`[dbl] Adding voter role for user: ${webhookPayload.user}`);
        await voteManager.addVoterRole(webhookPayload.user).catch(() => null);
        // Send DM to the user who voted
        Logger.debug(`[dbl] Sending DM to user: ${webhookPayload.user}`);
        voteManager.sendVoteDM(webhookPayload).catch(() => null);
      }

      Logger.debug(`[dbl] Announcing vote for user: ${webhookPayload.user}`);
      voteManager.announceVote(webhookPayload).catch(Logger.error);

      Logger.debug(`[dbl] Successfully processed vote for user: ${webhookPayload.user}`);
      return c.body(null, 204);
    }
    catch (err) {
      Logger.debug(
        `[dbl] Error caught in dbl handler: ${err instanceof Error ? err.message : String(err)}`,
      );
      handleError(err, { comment: 'Failed to process top.gg webhook' });

      // If it's already an HTTPException, just rethrow it
      if (err instanceof HTTPException) {
        throw err;
      }

      // Otherwise, create a new HTTPException
      const httpError = new HTTPException(500, {
        message: 'Failed to process top.gg webhook',
        cause: err,
      });
      // Ensure the stack trace is preserved
      if (err instanceof Error) {
        httpError.stack = err.stack;
      }
      throw httpError;
    }
  });

  app.post('/webhook', validateBody(webhookSchema), async (c) => {
    const body = c.req.valid('json');
    Logger.debug(
      `[webhook] Processing webhook request with ID: ${body.webhookUrl.split('/').at(-2)}...`,
    );

    let webhookData = webhookMap.get(body.webhookUrl);
    if (!webhookData) {
      Logger.debug(
        `[webhook] Creating new WebhookClient ID: ${body.webhookUrl.split('/').at(-2)}...`,
      );
      webhookData = { lastUsed: new Date(), client: new WebhookClient({ url: body.webhookUrl }) };
      webhookMap.set(body.webhookUrl, webhookData);
    }

    try {
      Logger.debug('[webhook] Attempting to send webhook message');
      const res = await webhookData.client.send(body.data);
      Logger.debug('[webhook] Successfully sent webhook message');
      return c.json({ data: res });
    }
    catch (err) {
      Logger.debug('[webhook] Error caught in webhook handler');
      Logger.error('Failed to send webhook message', err);

      // Check if the error is related to an invalid webhook
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isWebhookError =
        errorMessage.includes('Unknown Webhook') || errorMessage.includes('Invalid Webhook Token');

      if (isWebhookError) {
        Logger.debug('[webhook] Detected invalid webhook, removing from cache');
        // Remove the invalid webhook from the cache
        webhookMap.delete(body.webhookUrl);
      }

      // Return a proper error response instead of throwing
      return c.json(
        {
          message: 'Failed to send webhook message',
          error: errorMessage,
          isWebhookError,
        },
        500,
      );
    }
  });

  // Use the imported webhook message schema

  app.post('/webhook/message', validateBody(webhookMessageSchema), async (c) => {
    const body = c.req.valid('json');
    Logger.debug(
      `[webhook/message] Processing webhook message request with action: ${body.action}`,
    );

    let webhookData = webhookMap.get(body.webhookUrl);
    if (!webhookData) {
      Logger.debug(
        `[webhook/message] Creating new WebhookClient for URL: ${body.webhookUrl.substring(0, 20)}...`,
      );
      webhookData = { lastUsed: new Date(), client: new WebhookClient({ url: body.webhookUrl }) };
      webhookMap.set(body.webhookUrl, webhookData);
    }

    try {
      if (body.action === 'fetch') {
        // Fetch the message
        Logger.debug(`[webhook/message] Fetching message with ID: ${body.messageId}`);
        const message = await webhookData.client
          .fetchMessage(body.messageId, {
            threadId: body.threadId,
          })
          .catch((error) => {
            Logger.debug(`[webhook/message] Error fetching message: ${error.message}`);
            return null;
          });

        return c.json({ data: message });
      }

      if (body.action === 'edit') {
        // Edit the message
        Logger.debug(`[webhook/message] Editing message with ID: ${body.messageId}`);
        const message = await webhookData.client
          .editMessage(body.messageId, {
            ...body.data,
            threadId: body.threadId,
          })
          .catch((error) => {
            Logger.debug(`[webhook/message] Error editing message: ${error.message}`);
            return null;
          });

        return c.json({ data: message });
      }

      Logger.debug(`[webhook/message] Invalid action: ${body.action}`);
      throw new HTTPException(400, { message: 'Invalid action' });
    }
    catch (err) {
      Logger.debug(
        `[webhook/message] Error caught in webhook/message handler: ${err instanceof Error ? err.message : String(err)}`,
      );
      handleError(err, { comment: `Failed to ${body.action} webhook message` });

      // Check if the error is related to an invalid webhook
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isWebhookError =
        errorMessage.includes('Unknown Webhook') || errorMessage.includes('Invalid Webhook Token');

      if (isWebhookError) {
        Logger.debug('[webhook/message] Detected invalid webhook, removing from cache');
        // Remove the invalid webhook from the cache
        webhookMap.delete(body.webhookUrl);
      }

      // Return a proper error response instead of throwing
      return c.json(
        {
          message: `Failed to ${body.action} webhook message`,
          error: errorMessage,
          isWebhookError,
        },
        500,
      );
    }
  });

  // Use the imported reactions schema

  app.post('/reactions', validateBody(reactionsUpdateSchema), async (c) => {
    try {
      const { messageId, reactions } = c.req.valid('json');
      Logger.debug(`[reactions] Processing reactions update for message ID: ${messageId}`);

      // Find the original message
      Logger.debug(`[reactions] Finding original message with ID: ${messageId}`);
      const originalMessage = await findOriginalMessage(messageId);
      if (!originalMessage) {
        Logger.debug(`[reactions] Message not found with ID: ${messageId}`);
        throw new HTTPException(404, { message: 'Message not found' });
      }

      // Store the updated reactions in Redis
      Logger.debug(`[reactions] Storing reactions in Redis for message ID: ${messageId}`);
      await storeReactions(originalMessage, reactions);

      // Update all broadcast messages with the new reactions
      Logger.debug(
        `[reactions] Updating broadcast messages with new reactions for message ID: ${messageId}`,
      );
      await updateReactions(originalMessage, reactions);

      Logger.debug(`[reactions] Successfully updated reactions for message ID: ${messageId}`);
      return c.json({ success: true });
    }
    catch (err) {
      Logger.debug(
        `[reactions] Error caught in reactions handler: ${err instanceof Error ? err.message : String(err)}`,
      );
      handleError(err, { comment: 'Failed to update reactions' });

      // Return a proper error response instead of throwing
      const errorMessage = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          message: 'Failed to update reactions',
          error: errorMessage,
        },
        500,
      );
    }
  });

  metrics.setupMetricsEndpoint(app);

  app.all('*', (c) => c.redirect(Constants.Links.Website));

  serve({ fetch: app.fetch, port: Number(process.env.PORT || 3000) });
  Logger.info(`API server started on port ${process.env.PORT || 3000}`);
};
