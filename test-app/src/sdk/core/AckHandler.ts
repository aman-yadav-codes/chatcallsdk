import { AckResponse } from '../types';

/** Default timeout for acknowledgement-based calls */
const DEFAULT_ACK_TIMEOUT_MS = 10_000;

/**
 * Wraps a Socket.IO emit with ack into a Promise with timeout + optional retry.
 */
export function withAck<T = unknown>(
  emitFn: (ack: (res: AckResponse<T>) => void) => void,
  timeoutMs = DEFAULT_ACK_TIMEOUT_MS,
): Promise<AckResponse<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        success: false,
        error: { code: 'ACK_TIMEOUT', message: `No acknowledgement received within ${timeoutMs}ms` },
      });
    }, timeoutMs);

    emitFn((res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

/**
 * Emit with ack and retry up to maxRetries times on failure.
 */
export async function withAckRetry<T = unknown>(
  emitFn: (ack: (res: AckResponse<T>) => void) => void,
  maxRetries = 3,
  timeoutMs = DEFAULT_ACK_TIMEOUT_MS,
): Promise<AckResponse<T>> {
  let lastResult: AckResponse<T> = { success: false, error: { code: 'NEVER', message: '' } };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await withAck<T>(emitFn, timeoutMs);
    if (result.success) return result;

    // Don't retry on validation / auth errors — only on timeouts / network errors
    const code = result.error?.code ?? '';
    if (!['ACK_TIMEOUT', 'INTERNAL_ERROR', 'UNKNOWN_ERROR'].includes(code)) {
      return result;
    }

    lastResult = result;
    if (attempt < maxRetries) {
      // Exponential backoff between retries
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
    }
  }

  return lastResult;
}
