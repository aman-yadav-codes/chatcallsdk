import { Server, Socket } from 'socket.io';
import { redisClient } from '../../services/redis.service';
import { EVENTS } from '../../services/eventBus.service';
import { config } from '../../config';
import { createModuleLogger } from '../../utils/logger';
import { nowISO, userKey } from '../../utils/helpers';
import { PresencePayload, SubscribePresencePayload, AckResponse } from '../../types';

const log = createModuleLogger('PresenceModule');

// ─── Redis Key Builders ───────────────────────────────────────────────────────

const onlineKey = (projectId: string) => `online:${projectId}`;
const lastSeenKey = (projectId: string, userId: string) => `lastseen:${projectId}:${userId}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function setOnline(projectId: string, userId: string): Promise<void> {
  await redisClient.sadd(onlineKey(projectId), userId);
  // Reset TTL so presence key stays alive
  await redisClient.expire(onlineKey(projectId), config.redis.ttl.presence * 10);
}

async function setOffline(projectId: string, userId: string): Promise<void> {
  await redisClient.srem(onlineKey(projectId), userId);
  await redisClient.set(
    lastSeenKey(projectId, userId),
    nowISO(),
    'EX',
    config.redis.ttl.message,
  );
}

async function isOnline(projectId: string, userId: string): Promise<boolean> {
  return (await redisClient.sismember(onlineKey(projectId), userId)) === 1;
}

async function getLastSeen(projectId: string, userId: string): Promise<string | null> {
  return redisClient.get(lastSeenKey(projectId, userId));
}

// ─── Presence Module ──────────────────────────────────────────────────────────

export function registerPresenceModule(io: Server, socket: Socket): void {
  const { userId, projectId } = socket.meta;

  // Mark user online when they connect
  void (async () => {
    await setOnline(projectId, userId);
    // Join a personal room so other sockets can reach all of this user's connections
    await socket.join(userKey(projectId, userId));

    // Broadcast online to all subscribers
    const payload: PresencePayload = { userId, projectId, online: true };
    socket.broadcast.emit(EVENTS.PRESENCE_ONLINE, payload);
    log.debug(`[${projectId}] User online: ${userId}`);
  })();

  // ── presence:subscribe ────────────────────────────────────────────────────
  socket.on(
    EVENTS.PRESENCE_SUBSCRIBE,
    async (payload: SubscribePresencePayload, ack?: (res: AckResponse) => void) => {
      try {
        const { userIds } = payload;
        const statuses = await Promise.all(
          userIds.map(async (uid) => {
            const online = await isOnline(projectId, uid);
            const lastSeen = online ? undefined : (await getLastSeen(projectId, uid)) ?? undefined;
            return { userId: uid, online, lastSeen };
          }),
        );
        ack?.({ success: true, data: statuses });
      } catch (err) {
        log.error(`presence:subscribe error: ${(err as Error).message}`);
        ack?.({ success: false, error: { code: 'PRESENCE_ERROR', message: (err as Error).message } });
      }
    },
  );

  // ── Handle disconnect ─────────────────────────────────────────────────────
  socket.on('disconnect', async () => {
    // Only mark offline if this user has no other active sockets
    const userRoom = userKey(projectId, userId);
    const socketsInRoom = await io.in(userRoom).fetchSockets();
    const remaining = socketsInRoom.filter((s) => s.id !== socket.id);

    if (remaining.length === 0) {
      await setOffline(projectId, userId);
      const lastSeen = nowISO();
      const payload: PresencePayload = {
        userId,
        projectId,
        online: false,
        lastSeen,
      };
      io.emit(EVENTS.PRESENCE_OFFLINE, payload);
      log.debug(`[${projectId}] User offline: ${userId}, lastSeen: ${lastSeen}`);
    }
  });
}
