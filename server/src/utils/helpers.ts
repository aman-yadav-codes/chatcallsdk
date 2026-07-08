import { v4 as uuidv4 } from 'uuid';

/** Generate a UUID v4 */
export function generateId(): string {
  return uuidv4();
}

/** Current Unix timestamp in milliseconds */
export function nowMs(): number {
  return Date.now();
}

/** Current ISO timestamp string */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Build a deterministic private room ID from two user IDs.
 * Always produces the same ID regardless of argument order.
 */
export function buildPrivateRoomId(projectId: string, userA: string, userB: string): string {
  const sorted = [userA, userB].sort().join('::');
  return `${projectId}::private::${sorted}`;
}

/** Build a scoped Redis key: rtc:{prefix}:{projectId}:{rest} */
export function redisKey(prefix: string, projectId: string, ...parts: string[]): string {
  return [prefix, projectId, ...parts].join(':');
}

/** Build a scoped Socket.IO room name */
export function roomKey(projectId: string, roomId: string): string {
  return `${projectId}::room::${roomId}`;
}

/** Build a user presence key (all sockets for a user across devices) */
export function userKey(projectId: string, userId: string): string {
  return `${projectId}::user::${userId}`;
}

/** Sleep for N milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Safe JSON parse — returns undefined on error */
export function safeJsonParse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Clamp a number between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
