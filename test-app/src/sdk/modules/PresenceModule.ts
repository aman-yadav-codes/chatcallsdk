import { Socket } from 'socket.io-client';
import { TypedEventEmitter } from '../core/EventEmitter';
import { PresenceStatus } from '../types';

interface PresenceEvents {
  online: PresenceStatus;
  offline: PresenceStatus;
  lastSeen: PresenceStatus;
}

export class PresenceModule extends TypedEventEmitter<PresenceEvents> {
  constructor(private readonly socket: Socket) {
    super();
    this.bindServerEvents();
  }

  private bindServerEvents(): void {
    this.socket.on('presence:online', (payload: PresenceStatus) => this.emit('online', payload));
    this.socket.on('presence:offline', (payload: PresenceStatus) => this.emit('offline', payload));
    this.socket.on('presence:lastSeen', (payload: PresenceStatus) => this.emit('lastSeen', payload));
  }

  /**
   * Subscribe to presence updates for a list of users.
   * Returns their current status (online/offline + lastSeen).
   */
  async subscribe(userIds: string[]): Promise<PresenceStatus[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('presence:subscribe timeout')), 8_000);
      this.socket.emit('presence:subscribe', { userIds }, (res: { success: boolean; data?: PresenceStatus[]; error?: { message: string } }) => {
        clearTimeout(timer);
        if (res.success && res.data) resolve(res.data);
        else reject(new Error(res.error?.message ?? 'Failed to subscribe to presence'));
      });
    });
  }

  onOnline(handler: (status: PresenceStatus) => void): () => void {
    return this.on('online', handler);
  }

  onOffline(handler: (status: PresenceStatus) => void): () => void {
    return this.on('offline', handler);
  }

  onLastSeen(handler: (status: PresenceStatus) => void): () => void {
    return this.on('lastSeen', handler);
  }

  destroy(): void {
    this.socket.off('presence:online');
    this.socket.off('presence:offline');
    this.socket.off('presence:lastSeen');
    this.removeAllListeners();
  }
}
