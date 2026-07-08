import { Socket } from 'socket.io-client';
import { TypedEventEmitter } from '../core/EventEmitter';
import { Notification } from '../types';

interface NotificationEvents {
  new: Notification;
}

export class NotificationModule extends TypedEventEmitter<NotificationEvents> {
  constructor(private readonly socket: Socket) {
    super();
    this.socket.on('notification:new', (n: Notification) => this.emit('new', n));
  }

  onNew(handler: (notification: Notification) => void): () => void {
    return this.on('new', handler);
  }

  destroy(): void {
    this.socket.off('notification:new');
    this.removeAllListeners();
  }
}
