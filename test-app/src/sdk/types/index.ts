// ─── All shared types (mirrors server types, browser-safe) ────────────────────

export type CallState =
  | 'idle'
  | 'ringing'
  | 'accepted'
  | 'rejected'
  | 'ended'
  | 'missed'
  | 'busy';

export type MessageStatus = 'sent' | 'delivered' | 'read';
export type RoomType = 'private' | 'group';
export type MediaType = 'audio';

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface SDKConfig {
  serverUrl: string;
  projectId: string;
  apiKey: string;
  token: string;
  /** WebSocket reconnection options */
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
  reconnectionDelayMax?: number;
  timeout?: number;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  roomId: string;
  senderId: string;
  projectId: string;
  content: string;
  status: MessageStatus;
  createdAt: string;
  updatedAt?: string;
  tempId?: string;
}

export interface SendMessagePayload {
  roomId: string;
  content: string;
  tempId?: string;
}

export interface EditMessagePayload {
  messageId: string;
  roomId: string;
  content: string;
}

export interface DeleteMessagePayload {
  messageId: string;
  roomId: string;
}

export interface DeliveryPayload {
  messageId: string;
  roomId: string;
  userId: string;
  status: MessageStatus;
  timestamp: string;
}

// ─── Typing ───────────────────────────────────────────────────────────────────

export interface TypingPayload {
  roomId: string;
  userId: string;
  isTyping: boolean;
}

// ─── Presence ─────────────────────────────────────────────────────────────────

export interface PresenceStatus {
  userId: string;
  online: boolean;
  lastSeen?: string;
}

// ─── Rooms ────────────────────────────────────────────────────────────────────

export interface Room {
  id: string;
  projectId: string;
  type: RoomType;
  name?: string;
  members: string[];
  createdAt: string;
}

export interface CreateRoomPayload {
  name?: string;
  type: RoomType;
  members: string[];
}

// ─── Notifications ────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  userId: string;
  projectId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

// ─── Calls ────────────────────────────────────────────────────────────────────

export interface Call {
  id: string;
  projectId: string;
  callerId: string;
  calleeId: string;
  roomId: string;
  state: CallState;
  mediaType: MediaType;
  startedAt: string;
  answeredAt?: string;
  endedAt?: string;
}

export interface StartCallPayload {
  calleeId: string;
  roomId: string;
  mediaType?: MediaType;
}

// ─── WebRTC ───────────────────────────────────────────────────────────────────

export interface RTCSdpDescription {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface RTCIceCandidateInit {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

// ─── Quality Metrics ──────────────────────────────────────────────────────────

export interface ConnectionQuality {
  rtt: number;           // Round-trip time ms
  packetLoss: number;    // 0–100 %
  jitter: number;        // ms
  bitrate: number;       // kbps
  quality: 'excellent' | 'good' | 'fair' | 'poor';
}

// ─── SDK Metrics ──────────────────────────────────────────────────────────────

export interface SDKMetrics {
  socketLatency: number;
  reconnections: number;
  connected: boolean;
  activeCallId: string | null;
  callQuality: ConnectionQuality | null;
}

// ─── Ack ──────────────────────────────────────────────────────────────────────

export interface AckResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

// ─── ICE Server Config ────────────────────────────────────────────────────────

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface WebRTCConfig {
  iceServers?: IceServerConfig[];
  /** Opus codec options applied via SDP munging */
  opus?: {
    dtx?: boolean;   // Discontinuous Transmission (saves bandwidth during silence)
    fec?: boolean;   // Forward Error Correction (handles packet loss)
    stereo?: boolean;
    maxBitrate?: number; // kbps
  };
}
