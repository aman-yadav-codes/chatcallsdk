import { Socket } from 'socket.io-client';
import { TypedEventEmitter } from '../core/EventEmitter';
import { withAck } from '../core/AckHandler';
import { ConnectionQuality, RTCSdpDescription, RTCIceCandidateInit, WebRTCConfig, AckResponse } from '../types';
import { SocketManager } from '../core/SocketManager';

// ─── Inbound event shapes from server ────────────────────────────────────────

interface WebRTCEvents {
  offer: { callId: string; fromUserId: string; sdp: RTCSdpDescription; mediaType: string };
  answer: { callId: string; fromUserId: string; sdp: RTCSdpDescription; mediaType: string };
  iceCandidate: { callId: string; fromUserId: string; candidate: RTCIceCandidateInit };
  qualityChange: ConnectionQuality;
}

// ─── WebRTC Module ────────────────────────────────────────────────────────────

export class WebRTCModule extends TypedEventEmitter<WebRTCEvents> {
  private peerConnections = new Map<string, RTCPeerConnection>();
  private localStream: MediaStream | null = null;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private webrtcConfig: WebRTCConfig = {};

  // Adaptive bitrate state
  private currentBitrate = 40; // kbps — start conservative
  private readonly MIN_BITRATE = 6;
  private readonly MAX_BITRATE = 40;

  constructor(
    private readonly socket: Socket,
    // SocketManager passed for future metrics; accept but don't store to avoid lint warning
    _manager: SocketManager,
  ) {
    super();
    this.bindServerEvents();
  }

  private bindServerEvents(): void {
    this.socket.on('webrtc:offer', (payload: WebRTCEvents['offer']) => this.emit('offer', payload));
    this.socket.on('webrtc:answer', (payload: WebRTCEvents['answer']) => this.emit('answer', payload));
    this.socket.on('webrtc:ice', (payload: { callId: string; fromUserId: string; candidate: RTCIceCandidateInit }) =>
      this.emit('iceCandidate', payload),
    );
  }

  // ─── RTCPeerConnection Lifecycle ─────────────────────────────────────────

  /**
   * Initialize a peer connection for a call.
   * Call this before sendOffer or when you receive an offer.
   */
  async initialize(callId: string, config?: WebRTCConfig): Promise<RTCPeerConnection> {
    this.webrtcConfig = config ?? {};

    const iceServers = config?.iceServers ?? [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    const pc = new RTCPeerConnection({ iceServers });
    this.peerConnections.set(callId, pc);

    // Get user audio
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    for (const track of this.localStream.getTracks()) {
      pc.addTrack(track, this.localStream);
    }

    // ICE candidate handler — relay via server
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        const targetUserId = this.getTargetUserId(callId);
        if (targetUserId) {
          // Fire-and-forget — no ack needed for ICE
          this.socket.emit('webrtc:ice', {
            callId,
            targetUserId,
            candidate: {
              candidate: candidate.candidate,
              sdpMid: candidate.sdpMid,
              sdpMLineIndex: candidate.sdpMLineIndex,
              usernameFragment: candidate.usernameFragment,
            } satisfies RTCIceCandidateInit,
          });
        }
      }
    };

    // Start quality monitoring
    this.startQualityMonitor(callId, pc);

    return pc;
  }

  /**
   * Create and send an SDP offer (caller side).
   */
  async sendOffer(callId: string, targetUserId: string): Promise<AckResponse> {
    const pc = this.peerConnections.get(callId);
    if (!pc) throw new Error(`No peer connection for call ${callId}`);

    this.setTargetUserId(callId, targetUserId);

    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);

    const sdp = this.mutateSdpForOpus(offer.sdp ?? '');

    return withAck<void>((ack) =>
      this.socket.emit('webrtc:offer', {
        callId,
        targetUserId,
        sdp: { type: offer.type, sdp },
      }, ack),
    );
  }

  /**
   * Handle incoming offer and send answer (callee side).
   */
  async handleOffer(
    callId: string,
    targetUserId: string,
    sdp: RTCSdpDescription,
    config?: WebRTCConfig,
  ): Promise<AckResponse> {
    const pc = await this.initialize(callId, config);
    this.setTargetUserId(callId, targetUserId);

    await pc.setRemoteDescription(new RTCSessionDescription({ type: sdp.type as RTCSdpType, sdp: sdp.sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    const mutatedSdp = this.mutateSdpForOpus(answer.sdp ?? '');

    return withAck<void>((ack) =>
      this.socket.emit('webrtc:answer', {
        callId,
        targetUserId,
        sdp: { type: answer.type, sdp: mutatedSdp },
      }, ack),
    );
  }

  /**
   * Handle incoming answer (caller side).
   */
  async handleAnswer(callId: string, sdp: RTCSdpDescription): Promise<void> {
    const pc = this.peerConnections.get(callId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription({ type: sdp.type as RTCSdpType, sdp: sdp.sdp }));
  }

  /**
   * Add a remote ICE candidate.
   */
  async addIceCandidate(callId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peerConnections.get(callId);
    if (!pc || !pc.remoteDescription) {
      // Buffer until remote description is set — handled by server-side buffer
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Ignore stale ICE candidates
    }
  }

  /**
   * Trigger an ICE restart (e.g. after network change).
   */
  async restartIce(callId: string, targetUserId: string): Promise<void> {
    const pc = this.peerConnections.get(callId);
    if (!pc) return;
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    this.socket.emit('webrtc:offer', {
      callId,
      targetUserId,
      sdp: { type: offer.type, sdp: offer.sdp },
    });
  }

  /**
   * Clean up a peer connection after a call ends.
   */
  cleanup(callId: string): void {
    const pc = this.peerConnections.get(callId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(callId);
    }
    this.targetUserIds.delete(callId);

    if (this.peerConnections.size === 0) {
      this.stopQualityMonitor();
      // Stop local media tracks
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
  }

  // ─── SDP Mutation — Opus optimization ────────────────────────────────────
  // Enables DTX (saves bandwidth during silence) and in-band FEC (packet loss recovery)

  private mutateSdpForOpus(sdp: string): string {
    const opts = this.webrtcConfig.opus;
    if (!opts) return sdp;

    return sdp
      .split('\r\n')
      .map((line) => {
        if (!line.startsWith('a=fmtp:') || !line.includes('opus')) return line;
        const parts: string[] = [];
        parts.push('minptime=10');
        if (opts.fec !== false) parts.push('useinbandfec=1');
        if (opts.dtx !== false) parts.push('usedtx=1');
        if (opts.stereo) parts.push('stereo=1');
        return `${line};${parts.join(';')}`;
      })
      .join('\r\n');
  }

  // ─── Quality Monitoring ───────────────────────────────────────────────────

  private readonly STATS_INTERVAL_MS = 2_000;
  private prevStats = new Map<string, { bytesSent: number; timestamp: number }>();

  private startQualityMonitor(callId: string, pc: RTCPeerConnection): void {
    this.stopQualityMonitor();
    // callId is captured in closure for stats keying
    this.statsInterval = setInterval(async () => {
      const quality = await this.collectStats(callId, pc);
      if (quality) {
        this.emit('qualityChange', quality);
        await this.adaptBitrate(pc, quality);
      }
    }, this.STATS_INTERVAL_MS);
  }

  private stopQualityMonitor(): void {
    if (this.statsInterval !== null) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  private async collectStats(callId: string, pc: RTCPeerConnection): Promise<ConnectionQuality | null> {
    try {
      const report = await pc.getStats();
      let rtt = 0, packetLoss = 0, jitter = 0, bitrate = 0;

      report.forEach((stat) => {
        if (stat.type === 'remote-inbound-rtp' && stat.kind === 'audio') {
          rtt = (stat.roundTripTime ?? 0) * 1000;
          packetLoss = stat.fractionLost ? stat.fractionLost * 100 : 0;
          jitter = (stat.jitter ?? 0) * 1000;
        }
        if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
          const prev = this.prevStats.get(callId);
          const now = Date.now();
          if (prev) {
            const bytesDiff = (stat.bytesSent as number) - prev.bytesSent;
            const timeDiff = (now - prev.timestamp) / 1000;
            bitrate = timeDiff > 0 ? (bytesDiff * 8) / timeDiff / 1000 : 0; // kbps
          }
          this.prevStats.set(callId, { bytesSent: stat.bytesSent as number, timestamp: now });
        }
      });

      const quality = this.scoreQuality(rtt, packetLoss, jitter);
      return { rtt, packetLoss, jitter, bitrate, quality };
    } catch {
      return null;
    }
  }

  private scoreQuality(rtt: number, packetLoss: number, jitter: number): ConnectionQuality['quality'] {
    if (rtt < 100 && packetLoss < 1 && jitter < 20) return 'excellent';
    if (rtt < 200 && packetLoss < 5 && jitter < 50) return 'good';
    if (rtt < 400 && packetLoss < 15 && jitter < 100) return 'fair';
    return 'poor';
  }

  /** Reduce bitrate on poor networks, restore gradually on improvement */
  private async adaptBitrate(pc: RTCPeerConnection, quality: ConnectionQuality): Promise<void> {
    const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
    if (!sender) return;

    let targetBitrate: number;
    switch (quality.quality) {
      case 'excellent': targetBitrate = this.MAX_BITRATE; break;
      case 'good': targetBitrate = 24; break;
      case 'fair': targetBitrate = 12; break;
      case 'poor': targetBitrate = this.MIN_BITRATE; break;
    }

    // Gradual increase (ramp up), immediate decrease (ramp down)
    if (targetBitrate < this.currentBitrate) {
      this.currentBitrate = targetBitrate;
    } else {
      this.currentBitrate = Math.min(this.currentBitrate + 4, targetBitrate);
    }

    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = this.currentBitrate * 1000;
      await sender.setParameters(params);
    } catch {
      // setParameters may not be supported on all browsers — silently ignore
    }
  }

  // ─── Target user ID map ───────────────────────────────────────────────────
  private targetUserIds = new Map<string, string>();

  private setTargetUserId(callId: string, userId: string): void {
    this.targetUserIds.set(callId, userId);
  }

  private getTargetUserId(callId: string): string | undefined {
    return this.targetUserIds.get(callId);
  }

  // ─── Event hooks ─────────────────────────────────────────────────────────

  onOffer(handler: (payload: WebRTCEvents['offer']) => void): () => void { return this.on('offer', handler); }
  onAnswer(handler: (payload: WebRTCEvents['answer']) => void): () => void { return this.on('answer', handler); }
  onIceCandidate(handler: (payload: WebRTCEvents['iceCandidate']) => void): () => void { return this.on('iceCandidate', handler); }
  onQualityChange(handler: (quality: ConnectionQuality) => void): () => void { return this.on('qualityChange', handler); }

  destroy(): void {
    this.stopQualityMonitor();
    for (const [callId] of this.peerConnections) {
      this.cleanup(callId);
    }
    this.socket.off('webrtc:offer');
    this.socket.off('webrtc:answer');
    this.socket.off('webrtc:ice');
    this.removeAllListeners();
  }
}
