import { SocketManager } from './core/SocketManager';
import { ChatModule } from './modules/ChatModule';
import { PresenceModule } from './modules/PresenceModule';
import { RoomModule } from './modules/RoomModule';
import { TypingModule } from './modules/TypingModule';
import { NotificationModule } from './modules/NotificationModule';
import { CallModule } from './modules/CallModule';
import { WebRTCModule } from './modules/WebRTCModule';
import { SDKConfig, SDKMetrics } from './types';

export * from './types';
export * from './errors';

/**
 * CommunicationSDK — the single entry point for all real-time features.
 *
 * @example
 * ```ts
 * const sdk = new CommunicationSDK({
 *   serverUrl: 'http://localhost:3001',
 *   projectId: 'app1',
 *   apiKey: 'api-key-app1',
 *   token: userJwt,
 * });
 * await sdk.connect();
 *
 * // Get or create a private chat room
 * const { data: room } = await sdk.rooms.getPrivate('user-b-id');
 *
 * // Send a message
 * await sdk.chat.send({ roomId: room!.id, content: 'Hello!' });
 *
 * // Listen for incoming messages
 * sdk.chat.onNew((msg) => console.log('New message:', msg));
 * ```
 */
export class CommunicationSDK {
  private readonly manager: SocketManager;

  // ─── Modules ───────────────────────────────────────────────────────────────
  public readonly chat: ChatModule;
  public readonly presence: PresenceModule;
  public readonly rooms: RoomModule;
  public readonly typing: TypingModule;
  public readonly notifications: NotificationModule;
  public readonly calls: CallModule;
  public readonly webrtc: WebRTCModule;

  constructor(config: SDKConfig) {
    this.manager = new SocketManager(config);

    const socket = this.manager.getSocket();

    this.chat = new ChatModule(socket);
    this.presence = new PresenceModule(socket);
    this.rooms = new RoomModule(socket);
    this.typing = new TypingModule(socket);
    this.notifications = new NotificationModule(socket);
    this.calls = new CallModule(socket, this.manager);
    this.webrtc = new WebRTCModule(socket, this.manager);
  }

  // ─── Connection ────────────────────────────────────────────────────────────

  /** Connect to the server. Must be awaited before calling any module methods. */
  async connect(): Promise<void> {
    await this.manager.connect();
  }

  /** Check if the real-time server is reachable via HTTP /health endpoint. */
  async checkServerHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.manager.config.serverUrl}/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) return false;
      const data = await res.json();
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  /** Disconnect and clean up all resources. */
  disconnect(): void {
    this.typing.stopAll();
    this.chat.destroy();
    this.presence.destroy();
    this.rooms.destroy();
    this.typing.destroy();
    this.notifications.destroy();
    this.calls.destroy();
    this.webrtc.destroy();
    this.manager.disconnect();
  }

  /** Update JWT token without reconnecting (call after token refresh). */
  updateToken(newToken: string): void {
    this.manager.updateToken(newToken);
  }

  // ─── Metrics ───────────────────────────────────────────────────────────────

  get metrics(): Readonly<SDKMetrics> {
    return this.manager.metrics;
  }

  get isConnected(): boolean {
    return this.manager.isConnected;
  }
}
