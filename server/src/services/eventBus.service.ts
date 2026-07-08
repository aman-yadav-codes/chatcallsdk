import { Server } from 'socket.io';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('EventBus');

// ─── Internal Event Bus ───────────────────────────────────────────────────────
// A lightweight pub/sub within a single Node process.
// For multi-process scaling, use the Socket.IO Redis adapter instead.

type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

class EventBus {
  private subscriptions = new Map<string, Set<EventHandler>>();

  subscribe<T>(event: string, handler: EventHandler<T>): () => void {
    if (!this.subscriptions.has(event)) {
      this.subscriptions.set(event, new Set());
    }
    this.subscriptions.get(event)!.add(handler as EventHandler);

    return () => this.unsubscribe(event, handler as EventHandler);
  }

  unsubscribe(event: string, handler: EventHandler): void {
    this.subscriptions.get(event)?.delete(handler);
  }

  async publish<T>(event: string, data: T): Promise<void> {
    const handlers = this.subscriptions.get(event);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        await handler(data);
      } catch (err) {
        log.error(`EventBus handler error for event "${event}": ${(err as Error).message}`);
      }
    }
  }

  clear(): void {
    this.subscriptions.clear();
  }
}

export const eventBus = new EventBus();

// ─── Global IO Reference ──────────────────────────────────────────────────────
// Stored here so all modules can emit without circular imports

let _io: Server | null = null;

export function setIO(io: Server): void {
  _io = io;
}

export function getIO(): Server {
  if (!_io) throw new Error('Socket.IO server not initialized');
  return _io;
}

// ─── Event Name Constants ─────────────────────────────────────────────────────

export const EVENTS = {
  // Chat
  CHAT_SEND: 'chat:send',
  CHAT_NEW: 'chat:new',
  CHAT_EDIT: 'chat:edit',
  CHAT_EDITED: 'chat:edited',
  CHAT_DELETE: 'chat:delete',
  CHAT_DELETED: 'chat:deleted',
  CHAT_DELIVERED: 'chat:delivered',
  CHAT_READ: 'chat:read',

  // Typing
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  TYPING_CHANGE: 'typing:change',

  // Presence
  PRESENCE_SUBSCRIBE: 'presence:subscribe',
  PRESENCE_ONLINE: 'presence:online',
  PRESENCE_OFFLINE: 'presence:offline',
  PRESENCE_LAST_SEEN: 'presence:lastSeen',

  // Rooms
  ROOM_CREATE: 'room:create',
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  ROOM_CREATED: 'room:created',
  ROOM_JOINED: 'room:joined',
  ROOM_LEFT: 'room:left',
  ROOM_PRIVATE_GET: 'room:private:get',
  ROOM_MEMBERS_UPDATE: 'room:members:update',

  // Notifications
  NOTIFICATION_NEW: 'notification:new',
  NOTIFICATION_SEND: 'notification:send',

  // Calls
  CALL_START: 'call:start',
  CALL_RING: 'call:ring',
  CALL_ACCEPT: 'call:accept',
  CALL_REJECT: 'call:reject',
  CALL_END: 'call:end',
  CALL_MISSED: 'call:missed',
  CALL_BUSY: 'call:busy',
  CALL_STATE_CHANGE: 'call:stateChange',

  // WebRTC
  WEBRTC_OFFER: 'webrtc:offer',
  WEBRTC_ANSWER: 'webrtc:answer',
  WEBRTC_ICE: 'webrtc:ice',

  // System
  ERROR: 'error',
  HEARTBEAT_PING: 'heartbeat:ping',
  HEARTBEAT_PONG: 'heartbeat:pong',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
