import { Socket } from 'socket.io-client';
import { TypedEventEmitter } from '../core/EventEmitter';
import { withAckRetry } from '../core/AckHandler';
import {
  Message,
  SendMessagePayload,
  EditMessagePayload,
  DeleteMessagePayload,
  DeliveryPayload,
  AckResponse,
} from '../types';

// ─── Event map for consumer subscriptions ────────────────────────────────────

interface ChatEvents {
  new: Message;
  edited: Message;
  deleted: { messageId: string; roomId: string; deletedBy: string; timestamp: string };
  delivered: DeliveryPayload;
  read: DeliveryPayload;
}

// ─── Chat Module ──────────────────────────────────────────────────────────────

export class ChatModule extends TypedEventEmitter<ChatEvents> {
  constructor(private readonly socket: Socket) {
    super();
    this.bindServerEvents();
  }

  private bindServerEvents(): void {
    this.socket.on('chat:new', (msg: Message) => this.emit('new', msg));
    this.socket.on('chat:edited', (msg: Message) => this.emit('edited', msg));
    this.socket.on('chat:deleted', (payload) => this.emit('deleted', payload));
    this.socket.on('chat:delivered', (payload: DeliveryPayload) => this.emit('delivered', payload));
    this.socket.on('chat:read', (payload: DeliveryPayload) => this.emit('read', payload));
  }

  /**
   * Send a message to a room.
   * Retries up to 3 times on network errors.
   */
  async send(payload: SendMessagePayload): Promise<AckResponse<Message>> {
    return withAckRetry<Message>(
      (ack) => this.socket.emit('chat:send', payload, ack),
    );
  }

  /**
   * Edit an existing message (only sender can edit).
   */
  async edit(payload: EditMessagePayload): Promise<AckResponse<Message>> {
    return withAckRetry<Message>(
      (ack) => this.socket.emit('chat:edit', payload, ack),
    );
  }

  /**
   * Delete a message (only sender can delete).
   */
  async delete(payload: DeleteMessagePayload): Promise<AckResponse> {
    return withAckRetry(
      (ack) => this.socket.emit('chat:delete', payload, ack),
    );
  }

  /**
   * Mark a message as delivered. Fire-and-forget (no retry needed).
   */
  markDelivered(messageId: string, roomId: string): void {
    this.socket.emit('chat:delivered', {
      messageId,
      roomId,
      userId: '',  // server fills from socket.meta
      status: 'delivered',
      timestamp: new Date().toISOString(),
    } satisfies DeliveryPayload);
  }

  /**
   * Mark a message as read. Fire-and-forget.
   */
  markRead(messageId: string, roomId: string): void {
    this.socket.emit('chat:read', {
      messageId,
      roomId,
      userId: '',
      status: 'read',
      timestamp: new Date().toISOString(),
    } satisfies DeliveryPayload);
  }

  // ─── Convenience event methods ────────────────────────────────────────────

  onNew(handler: (msg: Message) => void): () => void {
    return this.on('new', handler);
  }

  onEdited(handler: (msg: Message) => void): () => void {
    return this.on('edited', handler);
  }

  onDeleted(handler: (payload: ChatEvents['deleted']) => void): () => void {
    return this.on('deleted', handler);
  }

  onDelivered(handler: (payload: DeliveryPayload) => void): () => void {
    return this.on('delivered', handler);
  }

  onRead(handler: (payload: DeliveryPayload) => void): () => void {
    return this.on('read', handler);
  }

  destroy(): void {
    this.socket.off('chat:new');
    this.socket.off('chat:edited');
    this.socket.off('chat:deleted');
    this.socket.off('chat:delivered');
    this.socket.off('chat:read');
    this.removeAllListeners();
  }
}
