// ─── Shared Event/Payload Types ───────────────────────────────────────────────

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

export type MediaType = 'audio'; // extend to 'audio' | 'video' later

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthPayload {
  userId: string;
  projectId: string;
  [key: string]: unknown;
}

export interface HandshakeAuth {
  token: string;
  projectId: string;
  apiKey: string;
}

// ─── Socket Meta (attached to each socket) ───────────────────────────────────

export interface SocketMeta {
  userId: string;
  projectId: string;
  connectedAt: number;
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
}

export interface SendMessagePayload {
  roomId: string;
  content: string;
  tempId?: string; // client-side optimistic ID
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

export interface PresencePayload {
  userId: string;
  projectId: string;
  online: boolean;
  lastSeen?: string;
}

export interface SubscribePresencePayload {
  userIds: string[];
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

export interface JoinRoomPayload {
  roomId: string;
}

export interface LeaveRoomPayload {
  roomId: string;
}

export interface GetPrivateRoomPayload {
  targetUserId: string;
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

export interface SendNotificationPayload {
  targetUserId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
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

export interface CallActionPayload {
  callId: string;
}

// ─── WebRTC ───────────────────────────────────────────────────────────────────
// NOTE: RTCSessionDescriptionInit and RTCIceCandidateInit are browser DOM types.
// On the server we treat these as opaque objects and relay them as-is.
// Defining plain equivalents here avoids depending on browser lib in the server tsconfig.

export interface RTCSdpDescription {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface RTCIceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface SDPPayload {
  callId: string;
  targetUserId: string;
  sdp: RTCSdpDescription;
  mediaType?: MediaType;
}

export interface ICECandidatePayload {
  callId: string;
  targetUserId: string;
  candidate: RTCIceCandidate;
}

// ─── Ack Response ─────────────────────────────────────────────────────────────

export interface AckResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ─── Error Serialized Shape ───────────────────────────────────────────────────

export interface SerializedError {
  code: string;
  message: string;
  details?: unknown;
}
