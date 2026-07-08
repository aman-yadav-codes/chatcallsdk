import { Server, Socket } from 'socket.io';
import { redisClient } from '../../services/redis.service';
import { EVENTS } from '../../services/eventBus.service';
import { config } from '../../config';
import { createModuleLogger } from '../../utils/logger';
import { serializeError } from '../../utils/errors';
import { CallError } from '../../utils/errors';
import { generateId, nowISO, userKey } from '../../utils/helpers';
import {
  Call,
  CallState,
  StartCallPayload,
  CallActionPayload,
  AckResponse,
} from '../../types';
import { deliverNotification } from '../notifications/notifications.module';

const log = createModuleLogger('CallsModule');

// ─── Redis Key Builders ───────────────────────────────────────────────────────

const callKey = (projectId: string, callId: string) => `call:${projectId}:${callId}`;
const activeCallKey = (projectId: string, userId: string) => `active-call:${projectId}:${userId}`;

// ─── Call State Management ────────────────────────────────────────────────────

async function saveCall(call: Call): Promise<void> {
  await redisClient.set(callKey(call.projectId, call.id), JSON.stringify(call), 'EX', config.calls.ringingTimeoutMs / 1000 + 600);
}

async function getCall(projectId: string, callId: string): Promise<Call | null> {
  const raw = await redisClient.get(callKey(projectId, callId));
  if (!raw) return null;
  try { return JSON.parse(raw) as Call; } catch { return null; }
}

async function updateCallState(projectId: string, callId: string, state: CallState, extra?: Partial<Call>): Promise<Call | null> {
  const call = await getCall(projectId, callId);
  if (!call) return null;
  const updated = { ...call, ...extra, state };
  await saveCall(updated);
  return updated;
}

async function setActiveCall(projectId: string, userId: string, callId: string): Promise<void> {
  await redisClient.set(activeCallKey(projectId, userId), callId, 'EX', config.redis.ttl.call);
}

async function clearActiveCall(projectId: string, userId: string): Promise<void> {
  await redisClient.del(activeCallKey(projectId, userId));
}

async function getActiveCallId(projectId: string, userId: string): Promise<string | null> {
  return redisClient.get(activeCallKey(projectId, userId));
}

// ─── Ringing Timeout Map ──────────────────────────────────────────────────────

const ringTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleRingTimeout(io: Server, call: Call): void {
  const timer = setTimeout(async () => {
    ringTimers.delete(call.id);
    const current = await getCall(call.projectId, call.id);
    if (current?.state !== 'ringing') return; // already resolved

    const missed = await updateCallState(call.projectId, call.id, 'missed', { endedAt: nowISO() });
    if (!missed) return;

    // Parallel cleanup
    await Promise.all([
      clearActiveCall(call.projectId, call.callerId),
      clearActiveCall(call.projectId, call.calleeId),
    ]);

    // Notify both parties
    const payload = { callId: call.id, callerId: call.callerId, calleeId: call.calleeId };
    io.to(userKey(call.projectId, call.callerId)).emit(EVENTS.CALL_MISSED, payload);
    io.to(userKey(call.projectId, call.calleeId)).emit(EVENTS.CALL_MISSED, payload);

    // Deliver offline notification for callee
    await deliverNotification(io, {
      id: generateId(),
      userId: call.calleeId,
      projectId: call.projectId,
      type: 'missed_call',
      title: 'Missed Call',
      body: `You missed a call from ${call.callerId}`,
      read: false,
      createdAt: nowISO(),
    });

    log.debug(`[${call.projectId}] Call ${call.id} missed (timeout)`);
  }, config.calls.ringingTimeoutMs);

  ringTimers.set(call.id, timer);
}

function cancelRingTimeout(callId: string): void {
  const timer = ringTimers.get(callId);
  if (timer) {
    clearTimeout(timer);
    ringTimers.delete(callId);
  }
}

// ─── Calls Module ─────────────────────────────────────────────────────────────

export function registerCallsModule(io: Server, socket: Socket): void {
  const { userId, projectId } = socket.meta;

  // ── call:start ────────────────────────────────────────────────────────────
  socket.on(
    EVENTS.CALL_START,
    async (payload: StartCallPayload, ack?: (res: AckResponse<Call>) => void) => {
      try {
        const { calleeId, roomId, mediaType = 'audio' } = payload;
        if (!calleeId || !roomId) throw new CallError('calleeId and roomId are required');
        if (calleeId === userId) throw new CallError('Cannot call yourself');

        // Check if caller is already in a call
        const callerActive = await getActiveCallId(projectId, userId);
        if (callerActive) throw new CallError('You are already in a call', { callId: callerActive });

        // Check if callee is busy
        const calleeActive = await getActiveCallId(projectId, calleeId);
        if (calleeActive) {
          socket.emit(EVENTS.CALL_BUSY, { callId: calleeActive, calleeId });
          ack?.({ success: false, error: { code: 'BUSY', message: 'Callee is in another call' } });
          return;
        }

        const call: Call = {
          id: generateId(),
          projectId,
          callerId: userId,
          calleeId,
          roomId,
          state: 'ringing',
          mediaType,
          startedAt: nowISO(),
        };

        // Pipeline: save call + set active for both users
        await Promise.all([
          saveCall(call),
          setActiveCall(projectId, userId, call.id),
          setActiveCall(projectId, calleeId, call.id),
        ]);

        // Notify callee (ring them)
        io.to(userKey(projectId, calleeId)).emit(EVENTS.CALL_RING, call);

        // Ack caller with full call object
        ack?.({ success: true, data: call });

        // Start missed call timeout
        scheduleRingTimeout(io, call);

        log.debug(`[${projectId}] Call started: ${call.id} from ${userId} to ${calleeId}`);
      } catch (err) {
        log.error(`call:start error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );

  // ── call:accept ───────────────────────────────────────────────────────────
  socket.on(
    EVENTS.CALL_ACCEPT,
    async (payload: CallActionPayload, ack?: (res: AckResponse<Call>) => void) => {
      try {
        const { callId } = payload;
        const call = await getCall(projectId, callId);
        if (!call) throw new CallError('Call not found');
        if (call.calleeId !== userId) throw new CallError('Only the callee can accept');
        if (call.state !== 'ringing') throw new CallError(`Call is ${call.state}, not ringing`);

        cancelRingTimeout(callId);
        const updated = await updateCallState(projectId, callId, 'accepted', { answeredAt: nowISO() });
        if (!updated) throw new CallError('Failed to update call state');

        // Notify caller
        io.to(userKey(projectId, call.callerId)).emit(EVENTS.CALL_ACCEPT, updated);
        ack?.({ success: true, data: updated });

        log.debug(`[${projectId}] Call accepted: ${callId} by ${userId}`);
      } catch (err) {
        log.error(`call:accept error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );

  // ── call:reject ───────────────────────────────────────────────────────────
  socket.on(
    EVENTS.CALL_REJECT,
    async (payload: CallActionPayload, ack?: (res: AckResponse) => void) => {
      try {
        const { callId } = payload;
        const call = await getCall(projectId, callId);
        if (!call) throw new CallError('Call not found');
        if (call.calleeId !== userId) throw new CallError('Only the callee can reject');

        cancelRingTimeout(callId);
        await updateCallState(projectId, callId, 'rejected', { endedAt: nowISO() });

        await Promise.all([
          clearActiveCall(projectId, call.callerId),
          clearActiveCall(projectId, call.calleeId),
        ]);

        io.to(userKey(projectId, call.callerId)).emit(EVENTS.CALL_REJECT, { callId, rejectedBy: userId });
        ack?.({ success: true });

        log.debug(`[${projectId}] Call rejected: ${callId} by ${userId}`);
      } catch (err) {
        log.error(`call:reject error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );

  // ── call:end ──────────────────────────────────────────────────────────────
  socket.on(
    EVENTS.CALL_END,
    async (payload: CallActionPayload, ack?: (res: AckResponse) => void) => {
      try {
        const { callId } = payload;
        const call = await getCall(projectId, callId);
        if (!call) throw new CallError('Call not found');
        if (call.callerId !== userId && call.calleeId !== userId) {
          throw new CallError('You are not a participant in this call');
        }

        cancelRingTimeout(callId);
        const updated = await updateCallState(projectId, callId, 'ended', { endedAt: nowISO() });

        await Promise.all([
          clearActiveCall(projectId, call.callerId),
          clearActiveCall(projectId, call.calleeId),
        ]);

        const endPayload = { callId, endedBy: userId, call: updated };
        io.to(userKey(projectId, call.callerId)).emit(EVENTS.CALL_END, endPayload);
        io.to(userKey(projectId, call.calleeId)).emit(EVENTS.CALL_END, endPayload);
        ack?.({ success: true });

        log.debug(`[${projectId}] Call ended: ${callId} by ${userId}`);
      } catch (err) {
        log.error(`call:end error: ${(err as Error).message}`);
        ack?.({ success: false, error: serializeError(err) });
      }
    },
  );

  // ── Handle disconnect during active call ──────────────────────────────────
  socket.on('disconnect', async () => {
    const activeCallId = await getActiveCallId(projectId, userId);
    if (!activeCallId) return;

    const call = await getCall(projectId, activeCallId);
    if (!call || (call.state !== 'ringing' && call.state !== 'accepted')) return;

    // Give the user 30s to reconnect before ending the call
    setTimeout(async () => {
      const current = await getCall(projectId, activeCallId);
      if (!current || (current.state !== 'ringing' && current.state !== 'accepted')) return;

      cancelRingTimeout(activeCallId);
      await updateCallState(projectId, activeCallId, 'ended', { endedAt: nowISO() });
      await Promise.all([
        clearActiveCall(projectId, call.callerId),
        clearActiveCall(projectId, call.calleeId),
      ]);

      const otherUserId = call.callerId === userId ? call.calleeId : call.callerId;
      io.to(userKey(projectId, otherUserId)).emit(EVENTS.CALL_END, {
        callId: activeCallId,
        endedBy: userId,
        reason: 'disconnected',
      });

      log.debug(`[${projectId}] Call ${activeCallId} ended due to disconnect of ${userId}`);
    }, 30_000);
  });
}
