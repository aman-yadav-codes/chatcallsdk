import { io, Socket } from 'socket.io-client';
import { SDKConfig, SDKMetrics } from '../types';

// ─── SocketManager ────────────────────────────────────────────────────────────
// Manages the socket lifecycle: connect, reconnect, auth, metrics.
// Applications must not interact with the socket directly.

export class SocketManager {
  private socket: Socket;
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

    // Create the Socket instance immediately with autoConnect: false.
    // This allows modules to bind event listeners (e.g. socket.on)
    // in their constructors before the network connection is established.
    this.socket = io(this.config.serverUrl, {
      transports: ['websocket'],
      autoConnect: false, // Wait until connect() is called explicitly
      auth: {
        token: this.config.token,
        projectId: this.config.projectId,
        apiKey: this.config.apiKey,
      },
      reconnection: this.config.reconnection ?? true,
      reconnectionAttempts: this.config.reconnectionAttempts ?? Infinity,
      reconnectionDelay: this.config.reconnectionDelay ?? 1_000,
      reconnectionDelayMax: this.config.reconnectionDelayMax ?? 30_000,
      randomizationFactor: 0.5,
      timeout: this.config.timeout ?? 10_000,
    });

    this.bindLifecycleEvents();
  }

  private bindLifecycleEvents(): void {
    this.socket.on('connect', () => {
      this._metrics.connected = true;
      this.startHeartbeat();
    });

    this.socket.on('disconnect', () => {
      this._metrics.connected = false;
      this.stopHeartbeat();
    });

    this.socket.on('reconnect', () => {
      this._metrics.reconnections++;
      this._metrics.connected = true;
      this.startHeartbeat();
    });
  }

  // ─── Connect ────────────────────────────────────────────────────────────────

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.connected) {
        resolve();
        return;
      }

      // Single-use listeners for connection success/error
      const onConnect = () => {
        this.socket.off('connect_error', onConnectError);
        resolve();
      };

      const onConnectError = (err: Error) => {
        this.socket.off('connect', onConnect);
        reject(new Error(`Connection failed: ${err.message}`));
      };

      this.socket.once('connect', onConnect);
      this.socket.once('connect_error', onConnectError);

      // Open the connection
      this.socket.connect();
    });
  }

  // ─── Disconnect ─────────────────────────────────────────────────────────────

  disconnect(): void {
    this.stopHeartbeat();
    this.socket.disconnect();
    this._metrics.connected = false;
  }

  // ─── Token Refresh ───────────────────────────────────────────────────────────

  updateToken(newToken: string): void {
    if (this.socket) {
      (this.socket.auth as Record<string, string>).token = newToken;
    }
  }

  // ─── Heartbeat ───────────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket.connected) return;
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
    return this.socket;
  }

  get isConnected(): boolean {
    return this.socket.connected;
  }

  get metrics(): Readonly<SDKMetrics> {
    return this._metrics;
  }

  setActiveCallId(callId: string | null): void {
    this._metrics.activeCallId = callId;
  }
}
