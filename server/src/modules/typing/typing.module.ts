import { Server, Socket } from 'socket.io';
import { EVENTS } from '../../services/eventBus.service';
import { config } from '../../config';
import { roomKey } from '../../utils/helpers';
import { TypingPayload } from '../../types';

// ─── Per-Room Typing State (in-memory, no Redis round trip needed) ────────────
// Map: `${projectId}:${roomId}:${userId}` → auto-stop timer handle

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function timerKey(projectId: string, roomId: string, userId: string): string {
  return `${projectId}:${roomId}:${userId}`;
}

function broadcastTyping(io: Server, projectId: string, roomId: string, userId: string, isTyping: boolean): void {
  // No ack needed for typing (fire-and-forget for low latency)
  io.to(roomKey(projectId, roomId)).emit(EVENTS.TYPING_CHANGE, {
    roomId,
    userId,
    isTyping,
  } satisfies TypingPayload);
}

// ─── Typing Module ────────────────────────────────────────────────────────────

export function registerTypingModule(io: Server, socket: Socket): void {
  const { userId, projectId } = socket.meta;

  // ── typing:start ──────────────────────────────────────────────────────────
  // No ack — fire and forget for minimal latency
  socket.on(EVENTS.TYPING_START, ({ roomId }: { roomId: string }) => {
    if (!roomId) return;

    const key = timerKey(projectId, roomId, userId);

    // Clear existing auto-stop timer (debounce)
    const existing = typingTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    } else {
      // Only broadcast on leading edge (first typing:start, not every keystroke)
      broadcastTyping(io, projectId, roomId, userId, true);
    }

    // Auto-stop after inactivity
    const timer = setTimeout(() => {
      typingTimers.delete(key);
      broadcastTyping(io, projectId, roomId, userId, false);
    }, config.typing.autoStopMs);

    typingTimers.set(key, timer);
  });

  // ── typing:stop ───────────────────────────────────────────────────────────
  socket.on(EVENTS.TYPING_STOP, ({ roomId }: { roomId: string }) => {
    if (!roomId) return;

    const key = timerKey(projectId, roomId, userId);
    const existing = typingTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      typingTimers.delete(key);
      broadcastTyping(io, projectId, roomId, userId, false);
    }
  });

  // ── Cleanup on disconnect ─────────────────────────────────────────────────
  socket.on('disconnect', () => {
    // Cancel all typing timers for this user across all rooms
    for (const [key, timer] of typingTimers.entries()) {
      if (key.startsWith(`${projectId}:`) && key.endsWith(`:${userId}`)) {
        clearTimeout(timer);
        typingTimers.delete(key);
        // key format: `${projectId}:${roomId}:${userId}`
        const withoutProject = key.slice(projectId.length + 1);
        const roomId = withoutProject.slice(0, withoutProject.lastIndexOf(':'));
        broadcastTyping(io, projectId, roomId, userId, false);
      }
    }
  });
}
