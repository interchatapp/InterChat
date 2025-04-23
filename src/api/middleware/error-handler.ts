import type { Context, MiddlewareHandler, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { handleError } from '#src/utils/Utils.js';

/**
 * Middleware to handle errors in the API
 */
export const errorHandler: MiddlewareHandler = async (c: Context, next: Next) => {
  try {
    await next();
  }
  catch (error) {
    handleError(error, { comment: 'API Error' });

    if (error instanceof HTTPException) {
      // Handle HTTP exceptions
      const cause = error.cause;

      if (cause instanceof ZodError) {
        // Format Zod validation errors
        return c.json({
          message: error.message,
          errors: cause.errors.map((err) => ({
            path: err.path.join('.'),
            message: err.message,
          })),
        }, error.status);
      }

      return c.json({
        message: error.message,
        ...(cause ? { details: cause } : {}),
      }, error.status);
    }

    // Handle unexpected errors
    return c.json({
      message: 'Internal Server Error',
    }, 500);
  }
};
