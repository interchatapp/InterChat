import type { ZodSchema } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import Logger from '#utils/Logger.js';

/**
 * Creates a middleware that validates the request body against a Zod schema
 * @param schema The Zod schema to validate against
 * @returns A middleware function
 */
export const validateBody = <T extends ZodSchema>(schema: T) => zValidator('json', schema, (result, c) => {
  if (!result.success) {
    Logger.warn('Validation error: %O', result.error);
    throw new HTTPException(400, {
      message: 'Invalid request body',
      cause: result.error,
    });
  }
  return c.json({ success: true });
});

/**
 * Creates a middleware that validates query parameters against a Zod schema
 * @param schema The Zod schema to validate against
 * @returns A middleware function
 */
export const validateQuery = <T extends ZodSchema>(schema: T) => zValidator('query', schema, (result, c) => {
  if (!result.success) {
    Logger.warn('Validation error: %O', result.error);
    throw new HTTPException(400, {
      message: 'Invalid query parameters',
      cause: result.error,
    });
  }
  return c.json({ success: true });
});

/**
 * Creates a middleware that validates path parameters against a Zod schema
 * @param schema The Zod schema to validate against
 * @returns A middleware function
 */
export const validateParams = <T extends ZodSchema>(schema: T) => zValidator('param', schema, (result, c) => {
  if (!result.success) {
    Logger.warn('Validation error: %O', result.error);
    throw new HTTPException(400, {
      message: 'Invalid path parameters',
      cause: result.error,
    });
  }
  return c.json({ success: true });
});
