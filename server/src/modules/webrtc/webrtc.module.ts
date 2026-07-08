import { Server, Socket } from 'socket.io';
import { redisClient } from '../../services/redis.service';
import { EVENTS } from '../../services/eventBus.service';
import { createModuleLogger } from '../../utils/logger';
import { serializeError } from '../../utils/errors';
import { userKey } from '../../utils/helpers';
import { RTCIceCandidate, SDPPayload, ICECandidatePayload, AckResponse } from '../../types';

const log = createModuleLogger('WebRTCModule');

// ─── In-flight ICE candidate buffer ──────────────────────────────────────────
// If the remote peer hasn't set a remote description yet, candidates are
// buffered in Redis (TTL 60s) so the target can drain them on readiness.

const iceBufferKey = (projectId: string, callId: string, userId: string) =>
  `ice-buf:${projectId}:${callId}:${userId}`;

async function bufferIceCandidate(
  projectId: string,
  callId: string,
  targetUserId: string,
  candidate: RTCIceCandidate,
): Promise<void> {
  const key = iceBufferKey(projectId, callId, targetUserId);
  const pipeline = redisClient.pipeline();
  pipeline.lpush(key, JSON.stringify(candidate));
  pipeline.expire(key, 60);
  await pipeline.exec();
}

async function drainIceBuffer(
  projectId: string,
  callId: string,
  userId: string,
): Promise<RTCIceCandidate[]> {
  const key = iceBufferKey(projectId, callId, userId);
  const pipeline = redisClient.pipeline();
  pipeline.lrange(key, 0, -1);
  pipeline.del(key);
  const results = await pipeline.exec();
  const raw = (results?.[0]?.[1] as string[]) ?? [];
  return raw
    .map((r) => { try { return JSON.parse(r) as RTCIceCandidate; } catch { return null; } })
    .filter((c): c is RTCIceCandidate => c !== null);
}

// ─── WebRTC Signaling Module ──────────────────────────────────────────────────

export function registerWebRTCModule(io: Server, socket: Socket): void {
  const { userId, projectId } = socket.meta;

  // ── webrtc:offer ──────────────────────────────────────────────────────────
  // Ack used — SDP is critical (relay failure = broken call)
  socket.on(
    EVENTS.WEBRTC_OFFER,
    async (payload: SDPPayload, ack?: (res: AckResponse) => void) => {
      try {
        const { callId, targetUserId, sdp, mediaType = 'audio' } = payload;
        if (!callId || !targetUserId || !sdp) {
          throw new Error('callId, targetUserId, and sdp are required');
        }

        const targetRoom = userKey(projectId, targetUserId);
        const targetSockets = await io.in(targetRoom).fetchSockets();

        if (targetSockets.length === 0) {
          throw new Error('Target user is not connected');
        }

        // Relay offer directly — no storage (ephemeral)
        io.to(targetRoom).emit(EVENTS.WEBRTC_OFFER, {
          callId,
          fromUserId: userId,
          sdp,
          mediaType,
        });

        // Drain any buffered ICE candidates (in case they arrived before offer)
        const buffered = await drainIceBuffer(projectId, callId, targetUserId);
        if (buffered.length > 0) {
          log.debug(`[${projectId}] Draining ${buffered.length} buffered ICE candidates for ${targetUserId}`);
          for (const candidate of buffered) {
            io.to(targetRoom).emit(EVENTS.WEBRTC_ICE, {
              callId,
              fromUserId: userId,
              candidate,
            });
          }
        }

        log.debug(`[${projectId}] WebRTC offer relayed: ${callId} ${userId} → ${targetUserId}`);
        ack?.({ success: true });
      } catch (err) {
        log.error(`webrtc:offer error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );

  // ── webrtc:answer ─────────────────────────────────────────────────────────
  socket.on(
    EVENTS.WEBRTC_ANSWER,
    async (payload: SDPPayload, ack?: (res: AckResponse) => void) => {
      try {
        const { callId, targetUserId, sdp, mediaType = 'audio' } = payload;
        if (!callId || !targetUserId || !sdp) {
          throw new Error('callId, targetUserId, and sdp are required');
        }

        const targetRoom = userKey(projectId, targetUserId);
        io.to(targetRoom).emit(EVENTS.WEBRTC_ANSWER, {
          callId,
          fromUserId: userId,
          sdp,
          mediaType,
        });

        // Drain buffered ICE candidates queued before answer was ready
        const buffered = await drainIceBuffer(projectId, callId, targetUserId);
        if (buffered.length > 0) {
          log.debug(`[${projectId}] Draining ${buffered.length} ICE candidates post-answer for ${targetUserId}`);
          for (const candidate of buffered) {
            io.to(targetRoom).emit(EVENTS.WEBRTC_ICE, {
              callId,
              fromUserId: userId,
              candidate,
            });
          }
        }

        log.debug(`[${projectId}] WebRTC answer relayed: ${callId} ${userId} → ${targetUserId}`);
        ack?.({ success: true });
      } catch (err) {
        log.error(`webrtc:answer error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );

  // ── webrtc:ice ────────────────────────────────────────────────────────────
  // No ack — ICE candidates are fire-and-forget; the WebRTC stack retries
  socket.on(EVENTS.WEBRTC_ICE, async (payload: ICECandidatePayload) => {
    try {
      const { callId, targetUserId, candidate } = payload;
      if (!callId || !targetUserId || !candidate) return;

      const targetRoom = userKey(projectId, targetUserId);
      const targetSockets = await io.in(targetRoom).fetchSockets();

      if (targetSockets.length > 0) {
        // Target is online — relay immediately
        io.to(targetRoom).emit(EVENTS.WEBRTC_ICE, {
          callId,
          fromUserId: userId,
          candidate,
        });
      } else {
        // Target may be momentarily reconnecting — buffer candidate
        await bufferIceCandidate(projectId, callId, targetUserId, candidate);
        log.debug(`[${projectId}] ICE candidate buffered for offline user ${targetUserId}`);
      }
    } catch (err) {
      log.error(`webrtc:ice error: ${(err as Error).message}`);
    }
  });
}
