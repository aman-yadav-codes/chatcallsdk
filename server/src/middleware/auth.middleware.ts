import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { getProject } from '../config';
import { AuthError } from '../utils/errors';
import { AuthPayload, HandshakeAuth, SocketMeta } from '../types';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('AuthMiddleware');

// Extend Socket to carry our metadata
declare module 'socket.io' {
  interface Socket {
    meta: SocketMeta;
  }
}

/**
 * Socket.IO authentication middleware.
 * Validates: API key → Project exists → JWT signature + claims.
 * Attaches `socket.meta` on success.
 */
export function authMiddleware(socket: Socket, next: (err?: Error) => void): void {
  try {
    const auth = socket.handshake.auth as Partial<HandshakeAuth>;

    if (!auth.projectId) {
      throw new AuthError('Missing projectId in handshake auth');
    }
    if (!auth.apiKey) {
      throw new AuthError('Missing apiKey in handshake auth');
    }
    if (!auth.token) {
      throw new AuthError('Missing token in handshake auth');
    }

    const project = getProject(auth.projectId);
    if (!project) {
      throw new AuthError(`Unknown projectId: ${auth.projectId}`);
    }
    if (project.apiKey !== auth.apiKey) {
      throw new AuthError('Invalid API key');
    }

    let payload: AuthPayload;
    try {
      payload = jwt.verify(auth.token, project.jwtSecret) as AuthPayload;
    } catch (jwtErr) {
      throw new AuthError(`JWT verification failed: ${(jwtErr as Error).message}`);
    }

    if (!payload.userId) {
      throw new AuthError('JWT payload must contain userId');
    }

    // Ensure projectId in token matches handshake (optional but recommended)
    if (payload.projectId && payload.projectId !== auth.projectId) {
      throw new AuthError('JWT projectId does not match handshake projectId');
    }

    // Attach metadata to the socket for use in all handlers
    socket.meta = {
      userId: payload.userId,
      projectId: auth.projectId,
      connectedAt: Date.now(),
    };

    log.debug(`Auth OK: user=${payload.userId} project=${auth.projectId} socket=${socket.id}`);
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      log.warn(`Auth failed for socket ${socket.id}: ${err.message}`);
      next(new Error(`AUTH:${err.message}`));
    } else {
      log.error(`Unexpected auth error: ${(err as Error).message}`);
      next(new Error('AUTH:Internal authentication error'));
    }
  }
}
