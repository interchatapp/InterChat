import { RedisKeys } from '#src/utils/Constants.js';
import getRedis from '#src/utils/Redis.js';

// Token Bucket parameters.
const MAX_TOKENS = 5; // Maximum tokens per bucket.
const REFILL_RATE = 0.5; // Tokens per second.
const COST_PER_MESSAGE = 1; // Each message costs 1 token.

// Interface for our bucket data.
interface TokenBucket {
  tokens: number;
  last: number; // Timestamp in milliseconds.
}

/**
 * Checks whether a message from a user is allowed based on the token bucket.
 * @returns `true` if allowed, `false` if considered spam.
 */
export async function checkSpam(userId: string): Promise<boolean> {
  const redis = getRedis();
  const now = Date.now();
  const bucketKey = `${RedisKeys.SpamBucket}:${userId}`;

  const bucketData = await redis.get(bucketKey);
  let bucket: TokenBucket;

  if (!bucketData) {
    // No bucket exists for this user; initialize with a full bucket.
    bucket = { tokens: MAX_TOKENS, last: now };
  }
  else {
    bucket = JSON.parse(bucketData) as TokenBucket;
    // Calculate how many tokens to add since the last update.
    const deltaSeconds = (now - bucket.last) / 1000;
    bucket.tokens = Math.min(MAX_TOKENS, bucket.tokens + deltaSeconds * REFILL_RATE);
    bucket.last = now;
  }

  // Check if there are enough tokens to send a message.
  if (bucket.tokens < COST_PER_MESSAGE) {
    // Update the bucket in Redis with an expiry.
    await redis.set(bucketKey, JSON.stringify(bucket), 'EX', Math.ceil(MAX_TOKENS / REFILL_RATE));
    return false; // Not enough tokens: message is spam.
  }
  else {
    // Deduct the cost for the message.
    bucket.tokens -= COST_PER_MESSAGE;
    await redis.set(bucketKey, JSON.stringify(bucket), 'EX', Math.ceil(MAX_TOKENS / REFILL_RATE));
    return true; // Message is allowed.
  }
}
