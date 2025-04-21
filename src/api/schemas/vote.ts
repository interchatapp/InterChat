import { z } from 'zod';
import type { WebhookPayload } from '#types/TopGGPayload.d.ts';

/**
 * Schema for validating top.gg vote webhook payloads
 */
export const votePayloadSchema = z.object({
  bot: z.string().regex(/^\d+$/, 'Bot ID must be a valid Discord snowflake').optional(),
  guild: z.string().regex(/^\d+$/, 'Guild ID must be a valid Discord snowflake').optional(),
  user: z.string().regex(/^\d+$/, 'User ID must be a valid Discord snowflake'),
  type: z.enum(['upvote', 'test']),
  isWeekend: z.boolean().optional(),
  query: z.union([
    z.string(),
    z.record(z.string()),
  ]).optional().default(''),
});

export type VotePayload = z.infer<typeof votePayloadSchema>;

/**
 * Convert a validated Zod payload to the WebhookPayload type
 */
export const toWebhookPayload = (data: VotePayload): WebhookPayload => ({
  bot: data.bot,
  guild: data.guild,
  user: data.user,
  type: data.type,
  isWeekend: data.isWeekend,
  query: data.query || '',
});
