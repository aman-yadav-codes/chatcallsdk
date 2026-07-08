export class SDKError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, code = 'SDK_ERROR', details?: unknown) {
    super(message);
    this.name = 'SDKError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConnectionError extends SDKError {
  constructor(message: string) {
    super(message, 'CONNECTION_ERROR');
    this.name = 'ConnectionError';
  }
}

export class AuthError extends SDKError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

export class CallError extends SDKError {
  constructor(message: string, details?: unknown) {
    super(message, 'CALL_ERROR', details);
    this.name = 'CallError';
  }
}

export class AckTimeoutError extends SDKError {
  constructor(event: string) {
    super(`No acknowledgement for "${event}" within timeout`, 'ACK_TIMEOUT');
    this.name = 'AckTimeoutError';
  }
}
