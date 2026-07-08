import { Socket } from 'socket.io-client';
import { TypedEventEmitter } from '../core/EventEmitter';
import { withAckRetry } from '../core/AckHandler';
import { Room, CreateRoomPayload, AckResponse } from '../types';

interface RoomEvents {
  created: Room;
  joined: { roomId: string; userId: string; members: string[] };
  left: { roomId: string; userId: string };
  membersUpdated: { roomId: string; members: string[] };
}

export class RoomModule extends TypedEventEmitter<RoomEvents> {
  constructor(private readonly socket: Socket) {
    super();
    this.bindServerEvents();
  }

  private bindServerEvents(): void {
    this.socket.on('room:created', (room: Room) => this.emit('created', room));
    this.socket.on('room:joined', (payload: RoomEvents['joined']) => this.emit('joined', payload));
    this.socket.on('room:left', (payload: RoomEvents['left']) => this.emit('left', payload));
    this.socket.on('room:members:update', (payload: RoomEvents['membersUpdated']) => this.emit('membersUpdated', payload));
  }

  async create(payload: CreateRoomPayload): Promise<AckResponse<Room>> {
    return withAckRetry<Room>((ack) => this.socket.emit('room:create', payload, ack));
  }

  async join(roomId: string): Promise<AckResponse<Room>> {
    return withAckRetry<Room>((ack) => this.socket.emit('room:join', { roomId }, ack));
  }

  async leave(roomId: string): Promise<AckResponse> {
    return withAckRetry((ack) => this.socket.emit('room:leave', { roomId }, ack));
  }

  /** Get or create a private room with another user */
  async getPrivate(targetUserId: string): Promise<AckResponse<Room>> {
    return withAckRetry<Room>((ack) =>
      this.socket.emit('room:private:get', { targetUserId }, ack),
    );
  }

  onCreated(handler: (room: Room) => void): () => void { return this.on('created', handler); }
  onJoined(handler: (p: RoomEvents['joined']) => void): () => void { return this.on('joined', handler); }
  onLeft(handler: (p: RoomEvents['left']) => void): () => void { return this.on('left', handler); }
  onMembersUpdated(handler: (p: RoomEvents['membersUpdated']) => void): () => void { return this.on('membersUpdated', handler); }

  destroy(): void {
    this.socket.off('room:created');
    this.socket.off('room:joined');
    this.socket.off('room:left');
    this.socket.off('room:members:update');
    this.removeAllListeners();
  }
}
