// ─── Base Error ───────────────────────────────────────────────────────────────

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(message: string, code: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined && { details: this.details }),
      },
    };
  }
}

// ─── Specific Error Types ─────────────────────────────────────────────────────

export class AuthError extends AppError {
  constructor(message = 'Authentication failed', details?: unknown) {
    super(message, 'AUTH_ERROR', 401, details);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied', details?: unknown) {
    super(message, 'FORBIDDEN', 403, details);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} '${id}' not found` : `${resource} not found`,
      'NOT_FOUND',
      404,
    );
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'RateLimitError';
  }
}

export class CallError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'CALL_ERROR', 400, details);
    this.name = 'CallError';
  }
}

// ─── Error Serializer (for Socket.IO ack responses) ──────────────────────────

export function serializeError(err: unknown): { code: string; message: string; details?: unknown } {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: err.message };
  }
  return { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred' };
}
