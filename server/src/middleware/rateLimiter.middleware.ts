import { Socket } from 'socket.io';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { config } from '../config';
import { RateLimitError } from '../utils/errors';
import { createModuleLogger } from '../utils/logger';
import { EVENTS } from '../services/eventBus.service';

const log = createModuleLogger('RateLimiter');

// ─── Per-Socket Rate Limiter ──────────────────────────────────────────────────

const limiter = new RateLimiterMemory({
  points: config.rateLimit.maxEvents,
  duration: Math.floor(config.rateLimit.windowMs / 1000),
});

/**
 * Wraps socket.onAny to rate-limit ALL incoming events.
 * If the socket exceeds the limit, an error is emitted and the event is dropped.
 */
export function applyRateLimiting(socket: Socket): void {
  socket.onAny(async (event: string, ...args: unknown[]) => {
    // Skip system events
    if (
      event === EVENTS.HEARTBEAT_PING ||
      event === EVENTS.HEARTBEAT_PONG
    ) {
      return;
    }

    try {
      await limiter.consume(`${socket.meta.projectId}:${socket.meta.userId}`);
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        const retryAfter = Math.ceil(err.msBeforeNext / 1000);
        log.warn(
          `Rate limited: user=${socket.meta.userId} project=${socket.meta.projectId} event=${event}`,
        );

        // Find the ack callback if present (last arg is function)
        const lastArg = args[args.length - 1];
        if (typeof lastArg === 'function') {
          const ack = lastArg as (response: unknown) => void;
          ack({
            success: false,
            error: new RateLimitError(`Rate limited. Retry after ${retryAfter}s`).toJSON().error,
          });
        } else {
          socket.emit(EVENTS.ERROR, {
            code: 'RATE_LIMIT',
            message: `Too many events. Retry after ${retryAfter}s`,
          });
        }
      }
    }
  });
}
