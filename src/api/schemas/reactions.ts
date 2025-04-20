import { z } from 'zod';

/**
 * Schema for validating reaction update payloads
 */
export const reactionsUpdateSchema = z.object({
  messageId: z.string().regex(/^\d+$/, 'Message ID must be a valid Discord snowflake'),
  reactions: z.record(z.array(z.string().regex(/^\d+$/, 'User ID must be a valid Discord snowflake'))),
});

export type ReactionsUpdatePayload = z.infer<typeof reactionsUpdateSchema>;
