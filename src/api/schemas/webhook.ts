import { z } from 'zod';

/**
 * Schema for validating webhook send payloads
 */
export const webhookSchema = z.object({
  webhookUrl: z.string().url('Invalid webhook URL'),
  data: z.record(z.any()),
});

export type WebhookPayload = z.infer<typeof webhookSchema>;

/**
 * Schema for validating webhook message operations
 */
export const webhookMessageSchema = z.object({
  webhookUrl: z.string().url('Invalid webhook URL'),
  messageId: z.string().regex(/^\d+$/, 'Message ID must be a valid Discord snowflake'),
  threadId: z.string().regex(/^\d+$/, 'Thread ID must be a valid Discord snowflake').optional(),
  action: z.enum(['fetch', 'edit']),
  data: z.record(z.any()).optional(),
});

export type WebhookMessagePayload = z.infer<typeof webhookMessageSchema>;
