import { Server, Socket } from 'socket.io';
import { redisClient } from '../../services/redis.service';
import { EVENTS } from '../../services/eventBus.service';
import { config } from '../../config';
import { createModuleLogger } from '../../utils/logger';
import { serializeError } from '../../utils/errors';
import { generateId, nowISO, userKey } from '../../utils/helpers';
import { Notification, SendNotificationPayload, AckResponse } from '../../types';

const log = createModuleLogger('NotificationsModule');

// ─── Redis Key Builders ───────────────────────────────────────────────────────

/** Pending offline notification queue for a user */
const offlineQueueKey = (projectId: string, userId: string) =>
  `notif-queue:${projectId}:${userId}`;

/** Deduplication set — track delivered notification IDs (TTL 24h) */
const deliveredKey = (projectId: string, userId: string) =>
  `notif-delivered:${projectId}:${userId}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function enqueueOfflineNotification(notification: Notification): Promise<void> {
  const key = offlineQueueKey(notification.projectId, notification.userId);
  const pipeline = redisClient.pipeline();
  pipeline.lpush(key, JSON.stringify(notification));
  pipeline.ltrim(key, 0, 99); // Keep max 100 queued
  pipeline.expire(key, config.redis.ttl.notification);
  await pipeline.exec();
}

async function flushOfflineQueue(projectId: string, userId: string): Promise<Notification[]> {
  const key = offlineQueueKey(projectId, userId);
  const pipeline = redisClient.pipeline();
  pipeline.lrange(key, 0, -1);
  pipeline.del(key);
  const results = await pipeline.exec();
  const rawList = (results?.[0]?.[1] as string[]) ?? [];
  return rawList
    .map((raw) => {
      try { return JSON.parse(raw) as Notification; } catch { return null; }
    })
    .filter((n): n is Notification => n !== null)
    .reverse(); // oldest first
}

async function isDuplicate(projectId: string, userId: string, notifId: string): Promise<boolean> {
  const key = deliveredKey(projectId, userId);
  const result = await redisClient.sadd(key, notifId);
  if (result === 0) return true; // already member
  await redisClient.expire(key, config.redis.ttl.notification);
  return false;
}

// ─── Notifications Module ─────────────────────────────────────────────────────

export function registerNotificationsModule(io: Server, socket: Socket): void {
  const { userId, projectId } = socket.meta;

  // On connect: flush any queued offline notifications
  void (async () => {
    const queued = await flushOfflineQueue(projectId, userId);
    if (queued.length > 0) {
      log.debug(`[${projectId}] Flushing ${queued.length} queued notifications to ${userId}`);
      for (const notif of queued) {
        socket.emit(EVENTS.NOTIFICATION_NEW, notif);
      }
    }
  })();

  // ── notification:send (server-to-user, triggered by other modules) ────────
  socket.on(
    EVENTS.NOTIFICATION_SEND,
    async (payload: SendNotificationPayload, ack?: (res: AckResponse<Notification>) => void) => {
      try {
        const { targetUserId, type, title, body, data } = payload;
        if (!targetUserId || !type || !title) {
          throw new Error('targetUserId, type, and title are required');
        }

        const notification: Notification = {
          id: generateId(),
          userId: targetUserId,
          projectId,
          type,
          title,
          body: body ?? '',
          data,
          read: false,
          createdAt: nowISO(),
        };

        await deliverNotification(io, notification);
        ack?.({ success: true, data: notification });
      } catch (err) {
        log.error(`notification:send error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );
}

/**
 * Deliver a notification to a user across all their connected devices.
 * Falls back to offline queue if no sockets are active.
 * Exported so other modules (calls, chat) can send notifications directly.
 */
export async function deliverNotification(io: Server, notification: Notification): Promise<void> {
  const { projectId, userId, id } = notification;

  // Deduplication check
  if (await isDuplicate(projectId, userId, id)) {
    log.debug(`[${projectId}] Duplicate notification ${id} for ${userId} — skipped`);
    return;
  }

  const userRoom = userKey(projectId, userId);
  const sockets = await io.in(userRoom).fetchSockets();

  if (sockets.length > 0) {
    // User is online — deliver to all devices immediately
    io.to(userRoom).emit(EVENTS.NOTIFICATION_NEW, notification);
    log.debug(`[${projectId}] Notification ${id} delivered to ${userId} (${sockets.length} devices)`);
  } else {
    // User is offline — enqueue for delivery on reconnect
    await enqueueOfflineNotification(notification);
    log.debug(`[${projectId}] Notification ${id} queued for offline user ${userId}`);
  }
}
