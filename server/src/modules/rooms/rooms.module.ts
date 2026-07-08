import { Server, Socket } from 'socket.io';
import { redisClient } from '../../services/redis.service';
import { EVENTS } from '../../services/eventBus.service';
import { createModuleLogger } from '../../utils/logger';
import { serializeError } from '../../utils/errors';
import { generateId, nowISO, roomKey, buildPrivateRoomId } from '../../utils/helpers';
import { Room, CreateRoomPayload, JoinRoomPayload, LeaveRoomPayload, GetPrivateRoomPayload, AckResponse } from '../../types';

const log = createModuleLogger('RoomsModule');

// ─── Redis Key Builders ───────────────────────────────────────────────────────

const roomMetaKey = (projectId: string, roomId: string) => `room:${projectId}:${roomId}`;
const userRoomsKey = (projectId: string, userId: string) => `user-rooms:${projectId}:${userId}`;

// ─── Pipeline Helpers ─────────────────────────────────────────────────────────

async function saveRoom(room: Room): Promise<void> {
  // Use pipeline to batch HSET + SADD in one round trip
  const pipeline = redisClient.pipeline();
  pipeline.hset(roomMetaKey(room.projectId, room.id), {
    id: room.id,
    projectId: room.projectId,
    type: room.type,
    name: room.name ?? '',
    members: JSON.stringify(room.members),
    createdAt: room.createdAt,
  });
  // Track which rooms each member belongs to
  for (const memberId of room.members) {
    pipeline.sadd(userRoomsKey(room.projectId, memberId), room.id);
  }
  await pipeline.exec();
}

async function getRoom(projectId: string, roomId: string): Promise<Room | null> {
  const data = await redisClient.hgetall(roomMetaKey(projectId, roomId));
  if (!data || !data.id) return null;
  return {
    id: data.id,
    projectId: data.projectId,
    type: data.type as Room['type'],
    name: data.name || undefined,
    members: JSON.parse(data.members ?? '[]') as string[],
    createdAt: data.createdAt,
  };
}

async function addMemberToRoom(projectId: string, roomId: string, userId: string): Promise<void> {
  const existing = await redisClient.hget(roomMetaKey(projectId, roomId), 'members');
  const members = JSON.parse(existing ?? '[]') as string[];
  if (!members.includes(userId)) {
    members.push(userId);
    const p = redisClient.pipeline();
    p.hset(roomMetaKey(projectId, roomId), 'members', JSON.stringify(members));
    p.sadd(userRoomsKey(projectId, userId), roomId);
    await p.exec();
  }
}

async function removeMemberFromRoom(projectId: string, roomId: string, userId: string): Promise<void> {
  const members = JSON.parse((await redisClient.hget(roomMetaKey(projectId, roomId), 'members')) ?? '[]') as string[];
  const updated = members.filter((m) => m !== userId);
  const p = redisClient.pipeline();
  p.hset(roomMetaKey(projectId, roomId), 'members', JSON.stringify(updated));
  p.srem(userRoomsKey(projectId, userId), roomId);
  await p.exec();
}

// ─── Rooms Module ─────────────────────────────────────────────────────────────

export function registerRoomsModule(io: Server, socket: Socket): void {
  const { userId, projectId } = socket.meta;

  // Auto-rejoin all user rooms on reconnect
  void (async () => {
    const roomIds = await redisClient.smembers(userRoomsKey(projectId, userId));
    if (roomIds.length > 0) {
      await socket.join(roomIds.map((id) => roomKey(projectId, id)));
      log.debug(`[${projectId}] User ${userId} rejoined ${roomIds.length} rooms`);
    }
  })();

  // ── room:create ───────────────────────────────────────────────────────────
  socket.on(
    EVENTS.ROOM_CREATE,
    async (payload: CreateRoomPayload, ack?: (res: AckResponse<Room>) => void) => {
      try {
        const { name, type, members } = payload;
        if (!type || !members?.length) throw new Error('type and members are required');

        const allMembers = Array.from(new Set([userId, ...members]));
        const room: Room = {
          id: generateId(),
          projectId,
          type,
          name,
          members: allMembers,
          createdAt: nowISO(),
        };

        await saveRoom(room);

        // Join all currently-connected members to the Socket.IO room
        const roomName = roomKey(projectId, room.id);
        await socket.join(roomName);

        // Notify all members and join their connected sockets to the room
        for (const memberId of allMembers) {
          const memberUserRoom = `${projectId}::user::${memberId}`;
          io.to(memberUserRoom).emit(EVENTS.ROOM_CREATED, room);
          // Best-effort: join all currently connected sockets of this member
          io.in(memberUserRoom).socketsJoin(roomName);
        }

        log.debug(`[${projectId}] Room created: ${room.id} by ${userId}`);
        ack?.({ success: true, data: room });
      } catch (err) {
        log.error(`room:create error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );

  // ── room:join ─────────────────────────────────────────────────────────────
  socket.on(
    EVENTS.ROOM_JOIN,
    async (payload: JoinRoomPayload, ack?: (res: AckResponse<Room>) => void) => {
      try {
        const { roomId } = payload;
        if (!roomId) throw new Error('roomId is required');

        const room = await getRoom(projectId, roomId);
        if (!room) throw new Error(`Room ${roomId} not found`);

        await addMemberToRoom(projectId, roomId, userId);
        await socket.join(roomKey(projectId, roomId));

        const updatedRoom = await getRoom(projectId, roomId);
        io.to(roomKey(projectId, roomId)).emit(EVENTS.ROOM_JOINED, {
          roomId,
          userId,
          members: updatedRoom?.members ?? [],
        });

        log.debug(`[${projectId}] User ${userId} joined room ${roomId}`);
        ack?.({ success: true, data: updatedRoom ?? room });
      } catch (err) {
        log.error(`room:join error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );

  // ── room:leave ────────────────────────────────────────────────────────────
  socket.on(
    EVENTS.ROOM_LEAVE,
    async (payload: LeaveRoomPayload, ack?: (res: AckResponse) => void) => {
      try {
        const { roomId } = payload;
        if (!roomId) throw new Error('roomId is required');

        await removeMemberFromRoom(projectId, roomId, userId);
        await socket.leave(roomKey(projectId, roomId));

        io.to(roomKey(projectId, roomId)).emit(EVENTS.ROOM_LEFT, { roomId, userId });

        log.debug(`[${projectId}] User ${userId} left room ${roomId}`);
        ack?.({ success: true });
      } catch (err) {
        log.error(`room:leave error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );

  // ── room:private:get ──────────────────────────────────────────────────────
  socket.on(
    EVENTS.ROOM_PRIVATE_GET,
    async (payload: GetPrivateRoomPayload, ack?: (res: AckResponse<Room>) => void) => {
      try {
        const { targetUserId } = payload;
        if (!targetUserId) throw new Error('targetUserId is required');

        const roomId = buildPrivateRoomId(projectId, userId, targetUserId);
        let room = await getRoom(projectId, roomId);

        if (!room) {
          // Create private room on demand
          room = {
            id: roomId,
            projectId,
            type: 'private',
            members: [userId, targetUserId],
            createdAt: nowISO(),
          };
          await saveRoom(room);
        }

        await socket.join(roomKey(projectId, roomId));
        ack?.({ success: true, data: room });
      } catch (err) {
        log.error(`room:private:get error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );
}
