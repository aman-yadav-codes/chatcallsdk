import Redis from 'ioredis';
import { config } from '../config';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('RedisService');

// ─── Redis Client Factory ─────────────────────────────────────────────────────
// NOTE: No keyPrefix on clients — all module keys are manually prefixed already.
// The pub/sub clients MUST NOT have keyPrefix because the Socket.IO Redis adapter
// uses its own internal key naming that would break with a prefix applied.

function createClient(name: string): Redis {
  const client = new Redis(config.redis.url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    retryStrategy: (times) => {
      if (times > 10) return null; // Stop retrying after 10 attempts
      const delay = Math.min(times * 200, 3000);
      log.warn(`Redis (${name}) reconnecting in ${delay}ms (attempt ${times})`);
      return delay;
    },
    reconnectOnError: (err) => {
      log.error(`Redis (${name}) connection error: ${err.message}`);
      return true;
    },
  });

  client.on('connect', () => log.info(`Redis (${name}) connected`));
  client.on('ready', () => log.info(`Redis (${name}) ready`));
  client.on('error', (err) => log.error(`Redis (${name}) error: ${err.message}`));
  client.on('close', () => log.warn(`Redis (${name}) connection closed`));

  return client;
}

// ─── Singleton Clients ────────────────────────────────────────────────────────

/** Main client for all read/write operations */
export const redisClient = createClient('main');

/** Dedicated subscriber — cannot share with command clients */
export const redisSub = createClient('sub');

/** Dedicated publisher — separate from main to avoid blocking */
export const redisPub = createClient('pub');

// ─── Connect / Disconnect ─────────────────────────────────────────────────────

export async function connectRedis(): Promise<void> {
  await Promise.all([
    redisClient.connect(),
    redisSub.connect(),
    redisPub.connect(),
  ]);
  log.info('All Redis connections established');
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all([
    redisClient.quit(),
    redisSub.quit(),
    redisPub.quit(),
  ]);
  log.info('All Redis connections closed');
}

// ─── Helper Operations ────────────────────────────────────────────────────────

/** Set a JSON value with optional TTL in seconds */
export async function setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  const serialized = JSON.stringify(value);
  if (ttlSeconds) {
    await redisClient.set(key, serialized, 'EX', ttlSeconds);
  } else {
    await redisClient.set(key, serialized);
  }
}

/** Get and deserialize a JSON value; returns null if missing or malformed */
export async function getJson<T>(key: string): Promise<T | null> {
  const raw = await redisClient.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Push a string to a Redis list and cap its length in one pipeline */
export async function listPush(key: string, value: string, maxLen = 500): Promise<void> {
  const pipeline = redisClient.pipeline();
  pipeline.lpush(key, value);
  pipeline.ltrim(key, 0, maxLen - 1);
  await pipeline.exec();
}

/** Get all items in a Redis list */
export async function listGetAll(key: string): Promise<string[]> {
  return redisClient.lrange(key, 0, -1);
}

/** Add member to a sorted set with score = timestamp */
export async function zAdd(key: string, score: number, member: string): Promise<void> {
  await redisClient.zadd(key, score, member);
}

/** Get all members from a sorted set */
export async function zGetAll(key: string): Promise<string[]> {
  return redisClient.zrange(key, 0, -1);
}

/** Remove member from a sorted set */
export async function zRemove(key: string, member: string): Promise<void> {
  await redisClient.zrem(key, member);
}
