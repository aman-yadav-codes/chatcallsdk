import { io, Socket } from 'socket.io-client';
import { SDKConfig, SDKMetrics } from '../types';

// ─── SocketManager ────────────────────────────────────────────────────────────
// Manages the socket lifecycle: connect, reconnect, auth, metrics.
// Applications must not interact with the socket directly.

export class SocketManager {
  private socket: Socket | null = null;
  public readonly config: SDKConfig;
  private _metrics: SDKMetrics = {
    socketLatency: 0,
    reconnections: 0,
    connected: false,
    activeCallId: null,
    callQuality: null,
  };

  // Heartbeat state
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly HEARTBEAT_INTERVAL = 25_000;

  constructor(config: SDKConfig) {
    this.config = config;
  }

  // ─── Connect ────────────────────────────────────────────────────────────────

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }

      this.socket = io(this.config.serverUrl, {
        // ── WebSocket only — no HTTP polling ──────────────────────────────
        transports: ['websocket'],

        // ── Auth payload ──────────────────────────────────────────────────
        auth: {
          token: this.config.token,
          projectId: this.config.projectId,
          apiKey: this.config.apiKey,
        },

        // ── Reconnection with exponential backoff ─────────────────────────
        reconnection: this.config.reconnection ?? true,
        reconnectionAttempts: this.config.reconnectionAttempts ?? Infinity,
        reconnectionDelay: this.config.reconnectionDelay ?? 1_000,
        reconnectionDelayMax: this.config.reconnectionDelayMax ?? 30_000,
        randomizationFactor: 0.5,

        // ── Connection timeout ────────────────────────────────────────────
        timeout: this.config.timeout ?? 10_000,

        // ── No compression for small real-time events ─────────────────────
        forceNew: false,
      });

      const onConnect = () => {
        this._metrics.connected = true;
        this.startHeartbeat();
        resolve();
      };

      const onConnectError = (err: Error) => {
        reject(new Error(`Connection failed: ${err.message}`));
      };

      this.socket.once('connect', onConnect);
      this.socket.once('connect_error', onConnectError);

      // ── Lifecycle events ────────────────────────────────────────────────
      this.socket.on('connect', () => {
        this._metrics.connected = true;
        this.startHeartbeat();
      });

      this.socket.on('disconnect', (_reason: string) => {
        this._metrics.connected = false;
        this.stopHeartbeat();
      });

      this.socket.on('reconnect', () => {
        this._metrics.reconnections++;
        this._metrics.connected = true;
        this.startHeartbeat();
      });
    });
  }

  // ─── Disconnect ─────────────────────────────────────────────────────────────

  disconnect(): void {
    this.stopHeartbeat();
    this.socket?.disconnect();
    this._metrics.connected = false;
  }

  // ─── Token Refresh ───────────────────────────────────────────────────────────
  // Call this when the JWT token is refreshed to update auth without reconnecting

  updateToken(newToken: string): void {
    if (this.socket) {
      (this.socket.auth as Record<string, string>).token = newToken;
    }
  }

  // ─── Heartbeat ───────────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket?.connected) return;
      const start = Date.now();
      this.socket.emit('heartbeat:ping', null, (res: { timestamp: number }) => {
        if (res) {
          this._metrics.socketLatency = Date.now() - start;
        }
      });
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── Accessors ───────────────────────────────────────────────────────────────

  getSocket(): Socket {
    if (!this.socket) throw new Error('SDK not connected. Call connect() first.');
    return this.socket;
  }

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  get metrics(): Readonly<SDKMetrics> {
    return this._metrics;
  }

  setActiveCallId(callId: string | null): void {
    this._metrics.activeCallId = callId;
  }
}
