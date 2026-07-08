import { Server, Socket } from 'socket.io';
import { redisClient, setJson, getJson, listPush } from '../../services/redis.service';
import { EVENTS } from '../../services/eventBus.service';
import { config } from '../../config';
import { createModuleLogger } from '../../utils/logger';
import { serializeError } from '../../utils/errors';
import { generateId, nowISO, roomKey, userKey } from '../../utils/helpers';
import {
  Message,
  SendMessagePayload,
  EditMessagePayload,
  DeleteMessagePayload,
  DeliveryPayload,
  AckResponse,
} from '../../types';

const log = createModuleLogger('ChatModule');

// ─── Redis Key Builders ───────────────────────────────────────────────────────

const msgKey = (projectId: string, messageId: string) =>
  `msg:${projectId}:${messageId}`;

const roomMsgsKey = (projectId: string, roomId: string) =>
  `room-msgs:${projectId}:${roomId}`;

// ─── Chat Module ──────────────────────────────────────────────────────────────

export function registerChatModule(io: Server, socket: Socket): void {
  const { userId, projectId } = socket.meta;

  // ── chat:send ──────────────────────────────────────────────────────────────
  socket.on(
    EVENTS.CHAT_SEND,
    async (payload: SendMessagePayload, ack?: (res: AckResponse<Message>) => void) => {
      try {
        const { roomId, content, tempId } = payload;

        if (!roomId || !content?.trim()) {
          throw new Error('roomId and content are required');
        }

        const message: Message = {
          id: generateId(),
          roomId,
          senderId: userId,
          projectId,
          content: content.trim(),
          status: 'sent',
          createdAt: nowISO(),
        };

        // Persist message
        await setJson(msgKey(projectId, message.id), message, config.redis.ttl.message);
        await listPush(roomMsgsKey(projectId, roomId), JSON.stringify(message));

        // Broadcast to room (including sender)
        io.to(roomKey(projectId, roomId)).emit(EVENTS.CHAT_NEW, {
          ...message,
          tempId,
        });

        log.debug(`[${projectId}] Message sent: ${message.id} in room ${roomId}`);
        ack?.({ success: true, data: message });
      } catch (err) {
        log.error(`chat:send error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );

  // ── chat:edit ─────────────────────────────────────────────────────────────
  socket.on(
    EVENTS.CHAT_EDIT,
    async (payload: EditMessagePayload, ack?: (res: AckResponse<Message>) => void) => {
      try {
        const { messageId, roomId, content } = payload;

        if (!messageId || !roomId || !content?.trim()) {
          throw new Error('messageId, roomId, and content are required');
        }

        const message = await getJson<Message>(msgKey(projectId, messageId));
        if (!message) throw new Error('Message not found');
        if (message.senderId !== userId) throw new Error('Cannot edit another user\'s message');

        const updated: Message = {
          ...message,
          content: content.trim(),
          updatedAt: nowISO(),
        };

        await setJson(msgKey(projectId, messageId), updated, config.redis.ttl.message);

        io.to(roomKey(projectId, roomId)).emit(EVENTS.CHAT_EDITED, updated);
        log.debug(`[${projectId}] Message edited: ${messageId}`);
        ack?.({ success: true, data: updated });
      } catch (err) {
        log.error(`chat:edit error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );

  // ── chat:delete ───────────────────────────────────────────────────────────
  socket.on(
    EVENTS.CHAT_DELETE,
    async (payload: DeleteMessagePayload, ack?: (res: AckResponse) => void) => {
      try {
        const { messageId, roomId } = payload;

        if (!messageId || !roomId) {
          throw new Error('messageId and roomId are required');
        }

        const message = await getJson<Message>(msgKey(projectId, messageId));
        if (!message) throw new Error('Message not found');
        if (message.senderId !== userId) throw new Error('Cannot delete another user\'s message');

        await redisClient.del(msgKey(projectId, messageId));

        io.to(roomKey(projectId, roomId)).emit(EVENTS.CHAT_DELETED, {
          messageId,
          roomId,
          deletedBy: userId,
          timestamp: nowISO(),
        });

        log.debug(`[${projectId}] Message deleted: ${messageId}`);
        ack?.({ success: true });
      } catch (err) {
        log.error(`chat:delete error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );

  // ── chat:delivered ────────────────────────────────────────────────────────
  socket.on(
    EVENTS.CHAT_DELIVERED,
    async (payload: DeliveryPayload, ack?: (res: AckResponse) => void) => {
      try {
        const { messageId, roomId } = payload;

        const message = await getJson<Message>(msgKey(projectId, messageId));
        if (message && message.status === 'sent') {
          const updated = { ...message, status: 'delivered' as const };
          await setJson(msgKey(projectId, messageId), updated, config.redis.ttl.message);

          // Notify sender
          const senderRoomKey = userKey(projectId, message.senderId);
          io.to(senderRoomKey).emit(EVENTS.CHAT_DELIVERED, {
            messageId,
            roomId,
            userId,
            status: 'delivered',
            timestamp: nowISO(),
          } satisfies DeliveryPayload);
        }

        ack?.({ success: true });
      } catch (err) {
        log.error(`chat:delivered error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );

  // ── chat:read ─────────────────────────────────────────────────────────────
  socket.on(
    EVENTS.CHAT_READ,
    async (payload: DeliveryPayload, ack?: (res: AckResponse) => void) => {
      try {
        const { messageId, roomId } = payload;

        const message = await getJson<Message>(msgKey(projectId, messageId));
        if (message && message.status !== 'read') {
          const updated = { ...message, status: 'read' as const };
          await setJson(msgKey(projectId, messageId), updated, config.redis.ttl.message);

          const senderRoomKey = userKey(projectId, message.senderId);
          io.to(senderRoomKey).emit(EVENTS.CHAT_READ, {
            messageId,
            roomId,
            userId,
            status: 'read',
            timestamp: nowISO(),
          } satisfies DeliveryPayload);
        }

        ack?.({ success: true });
      } catch (err) {
        log.error(`chat:read error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );
}
