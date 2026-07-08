import { Socket } from 'socket.io-client';
import { TypedEventEmitter } from '../core/EventEmitter';
import { withAckRetry } from '../core/AckHandler';
import { Call, StartCallPayload, AckResponse } from '../types';
import { SocketManager } from '../core/SocketManager';

interface CallEvents {
  ringing: Call;
  accepted: Call;
  rejected: { callId: string; rejectedBy: string };
  ended: { callId: string; endedBy: string; reason?: string; call?: Call };
  missed: { callId: string; callerId: string; calleeId: string };
  busy: { callId: string; calleeId: string };
  stateChange: { callId: string; state: Call['state'] };
}

export class CallModule extends TypedEventEmitter<CallEvents> {
  constructor(
    private readonly socket: Socket,
    private readonly manager: SocketManager,
  ) {
    super();
    this.bindServerEvents();
  }

  private bindServerEvents(): void {
    this.socket.on('call:ring', (call: Call) => {
      this.manager.setActiveCallId(call.id);
      this.emit('ringing', call);
    });

    this.socket.on('call:accept', (call: Call) => {
      this.emit('accepted', call);
      this.emit('stateChange', { callId: call.id, state: 'accepted' });
    });

    this.socket.on('call:reject', (payload: { callId: string; rejectedBy: string }) => {
      this.manager.setActiveCallId(null);
      this.emit('rejected', payload);
      this.emit('stateChange', { callId: payload.callId, state: 'rejected' });
    });

    this.socket.on('call:end', (payload: { callId: string; endedBy: string; reason?: string; call?: Call }) => {
      this.manager.setActiveCallId(null);
      this.emit('ended', payload);
      this.emit('stateChange', { callId: payload.callId, state: 'ended' });
    });

    this.socket.on('call:missed', (payload: { callId: string; callerId: string; calleeId: string }) => {
      this.manager.setActiveCallId(null);
      this.emit('missed', payload);
      this.emit('stateChange', { callId: payload.callId, state: 'missed' });
    });

    this.socket.on('call:busy', (payload: { callId: string; calleeId: string }) => {
      this.emit('busy', payload);
    });
  }

  /**
   * Start an audio call to another user.
   * Returns the Call object with a callId needed for WebRTC signaling.
   */
  async start(payload: StartCallPayload): Promise<AckResponse<Call>> {
    const result = await withAckRetry<Call>(
      (ack) => this.socket.emit('call:start', { ...payload, mediaType: payload.mediaType ?? 'audio' }, ack),
      1, // Only retry once for calls — avoid double-ringing
    );
    if (result.success && result.data) {
      this.manager.setActiveCallId(result.data.id);
    }
    return result;
  }

  async accept(callId: string): Promise<AckResponse<Call>> {
    const result = await withAckRetry<Call>((ack) => this.socket.emit('call:accept', { callId }, ack), 2);
    if (result.success) this.manager.setActiveCallId(callId);
    return result;
  }

  async reject(callId: string): Promise<AckResponse> {
    const result = await withAckRetry((ack) => this.socket.emit('call:reject', { callId }, ack), 2);
    if (result.success) this.manager.setActiveCallId(null);
    return result;
  }

  async end(callId: string): Promise<AckResponse> {
    const result = await withAckRetry((ack) => this.socket.emit('call:end', { callId }, ack), 2);
    if (result.success) this.manager.setActiveCallId(null);
    return result;
  }

  // ─── Convenience event handlers ───────────────────────────────────────────

  onRinging(handler: (call: Call) => void): () => void { return this.on('ringing', handler); }
  onAccepted(handler: (call: Call) => void): () => void { return this.on('accepted', handler); }
  onRejected(handler: (p: CallEvents['rejected']) => void): () => void { return this.on('rejected', handler); }
  onEnded(handler: (p: CallEvents['ended']) => void): () => void { return this.on('ended', handler); }
  onMissed(handler: (p: CallEvents['missed']) => void): () => void { return this.on('missed', handler); }
  onBusy(handler: (p: CallEvents['busy']) => void): () => void { return this.on('busy', handler); }
  onStateChange(handler: (p: CallEvents['stateChange']) => void): () => void { return this.on('stateChange', handler); }

  destroy(): void {
    ['call:ring','call:accept','call:reject','call:end','call:missed','call:busy'].forEach(e => this.socket.off(e));
    this.removeAllListeners();
  }
}
