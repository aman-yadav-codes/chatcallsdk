import { Socket } from 'socket.io-client';
import { TypedEventEmitter } from '../core/EventEmitter';
import { TypingPayload } from '../types';

interface TypingEvents {
  change: TypingPayload;
}

export class TypingModule extends TypedEventEmitter<TypingEvents> {
  /** Debounce timers per roomId — leading-edge only, mirrors server behaviour */
  private readonly activeRooms = new Set<string>();
  private readonly stopTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly STOP_DELAY_MS = 4_000; // slightly under server's 5s auto-stop

  constructor(private readonly socket: Socket) {
    super();
    this.socket.on('typing:change', (payload: TypingPayload) => this.emit('change', payload));
  }

  /**
   * Signal that the local user started typing in a room.
   * Only sends the event on the leading edge — subsequent calls within
   * STOP_DELAY_MS just reset the auto-stop timer without sending again.
   */
  start(roomId: string): void {
    const existing = this.stopTimers.get(roomId);
    if (existing) {
      clearTimeout(existing);
    } else {
      // Leading edge: only emit on first call
      this.socket.emit('typing:start', { roomId });
      this.activeRooms.add(roomId);
    }

    // Schedule auto-stop
    const timer = setTimeout(() => {
      this.stopTimers.delete(roomId);
      this.activeRooms.delete(roomId);
      this.socket.emit('typing:stop', { roomId });
    }, this.STOP_DELAY_MS);

    this.stopTimers.set(roomId, timer);
  }

  /** Immediately signal typing stopped */
  stop(roomId: string): void {
    const timer = this.stopTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.stopTimers.delete(roomId);
    }
    if (this.activeRooms.has(roomId)) {
      this.activeRooms.delete(roomId);
      this.socket.emit('typing:stop', { roomId });
    }
  }

  /** Stop all active typing indicators (e.g. on page change) */
  stopAll(): void {
    for (const roomId of this.activeRooms) {
      this.stop(roomId);
    }
  }

  onChange(handler: (payload: TypingPayload) => void): () => void {
    return this.on('change', handler);
  }

  destroy(): void {
    this.stopAll();
    this.socket.off('typing:change');
    this.removeAllListeners();
  }
}
