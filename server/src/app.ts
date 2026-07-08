import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import cors from 'cors';
import helmet from 'helmet';

import { config } from './config';
import { connectRedis, disconnectRedis, redisClient, redisPub, redisSub } from './services/redis.service';
import { setIO, EVENTS } from './services/eventBus.service';
import { authMiddleware } from './middleware/auth.middleware';
import { applyRateLimiting } from './middleware/rateLimiter.middleware';
import { registerChatModule } from './modules/chat/chat.module';
import { registerPresenceModule } from './modules/presence/presence.module';
import { registerRoomsModule } from './modules/rooms/rooms.module';
import { registerTypingModule } from './modules/typing/typing.module';
import { registerNotificationsModule } from './modules/notifications/notifications.module';
import { registerCallsModule } from './modules/calls/calls.module';
import { registerWebRTCModule } from './modules/webrtc/webrtc.module';
import { createModuleLogger } from './utils/logger';
import { logger } from './utils/logger';

const log = createModuleLogger('App');

// ─── Express App ──────────────────────────────────────────────────────────────

const app = express();

// Helmet security headers (configured to allow Socket.IO connections)
app.use(helmet());

// Dynamic CORS configuration to support credentials with wildcard '*'
app.use(
  cors({
    origin: (_origin, callback) => {
      // If CORS_ORIGINS contains '*', allow the requesting origin dynamically
      if (config.corsOrigins.includes('*')) {
        callback(null, true);
      } else {
        callback(null, config.corsOrigins);
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));

// ── Health Check ──────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  let redisStatus = 'ok';
  try {
    await redisClient.ping();
  } catch {
    redisStatus = 'error';
  }

  const mem = process.memoryUsage();
  const toMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    version: process.env.npm_package_version ?? '1.0.0',
    nodeEnv: config.nodeEnv,
    redis: redisStatus,
    memory: {
      rss: toMB(mem.rss),
      heapUsed: toMB(mem.heapUsed),
      heapTotal: toMB(mem.heapTotal),
      external: toMB(mem.external),
    },
    timestamp: new Date().toISOString(),
  });
});

// ── Metrics (lightweight Prometheus-compatible) ───────────────────────────────

app.get('/metrics', (_req, res) => {
  const mem = process.memoryUsage();
  const lines = [
    `# HELP process_heap_bytes Node.js heap memory`,
    `# TYPE process_heap_bytes gauge`,
    `process_heap_bytes{type="used"} ${mem.heapUsed}`,
    `process_heap_bytes{type="total"} ${mem.heapTotal}`,
    `process_heap_bytes{type="rss"} ${mem.rss}`,
    `# HELP process_uptime_seconds Server uptime`,
    `# TYPE process_uptime_seconds counter`,
    `process_uptime_seconds ${process.uptime().toFixed(2)}`,
  ];

  if (io) {
    void io.fetchSockets().then((sockets) => {
      lines.push(
        `# HELP socketio_connections_total Active socket connections`,
        `# TYPE socketio_connections_total gauge`,
        `socketio_connections_total ${sockets.length}`,
      );
      res.set('Content-Type', 'text/plain').send(lines.join('\n'));
    });
  } else {
    res.set('Content-Type', 'text/plain').send(lines.join('\n'));
  }
});

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const httpServer = createServer(app);

// ─── Socket.IO Server ─────────────────────────────────────────────────────────

let io: Server;

async function createSocketServer(): Promise<Server> {
  const server = new Server(httpServer, {
    // ── Transport: WebSocket only (no polling) ──────────────────────────────
    transports: ['websocket'],

    // ── Compression: disabled for low-latency small events ─────────────────
    // Individual emit calls can override this with { compress: true }
    perMessageDeflate: false,
    httpCompression: false,

    // ── Connection settings ─────────────────────────────────────────────────
    pingInterval: config.heartbeat.intervalMs,
    pingTimeout: config.heartbeat.timeoutMs,
    connectTimeout: 10_000,

    // ── CORS ────────────────────────────────────────────────────────────────
    cors: {
      origin: config.corsOrigins,
      credentials: true,
    },

    // ── Max payload size ────────────────────────────────────────────────────
    maxHttpBufferSize: 1e6, // 1MB

    // ── Adapter: Redis (for horizontal scaling) ─────────────────────────────
    adapter: createAdapter(redisPub, redisSub, {
      key: `${config.redis.keyPrefix}socket.io`,
    }),
  });

  return server;
}

// ─── Socket Registration ──────────────────────────────────────────────────────

function registerSocket(socket: import('socket.io').Socket): void {
  const { userId, projectId } = socket.meta;

  log.info(`Socket connected: ${socket.id} user=${userId} project=${projectId}`);

  // Apply per-socket rate limiting
  applyRateLimiting(socket);

  // ── Register all modules ──────────────────────────────────────────────────
  registerPresenceModule(io, socket);
  registerRoomsModule(io, socket);
  registerChatModule(io, socket);
  registerTypingModule(io, socket);
  registerNotificationsModule(io, socket);
  registerCallsModule(io, socket);
  registerWebRTCModule(io, socket);

  // ── Heartbeat (pong response) ─────────────────────────────────────────────
  socket.on(EVENTS.HEARTBEAT_PING, (_, ack?: (res: { timestamp: number }) => void) => {
    ack?.({ timestamp: Date.now() });
  });

  // ── Disconnect logging ────────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    log.info(`Socket disconnected: ${socket.id} user=${userId} project=${projectId} reason=${reason}`);
  });

  // ── Error handling ────────────────────────────────────────────────────────
  socket.on('error', (err: Error) => {
    log.error(`Socket error: ${socket.id} — ${err.message}`);
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // 1. Connect Redis
  await connectRedis();

  // 2. Create Socket.IO with Redis adapter
  io = await createSocketServer();
  setIO(io);

  // 3. Auth middleware (runs before any event handler)
  io.use(authMiddleware);

  // 4. Register event handlers for each new connection
  io.on('connection', registerSocket);

  // 5. Start HTTP server
  httpServer.listen(config.port, () => {
    log.info(`🚀 Server running on port ${config.port} [${config.nodeEnv}]`);
    log.info(`📡 ${config.projects.length} project(s) configured`);
    log.info(`🔴 Redis: ${config.redis.url}`);
  });
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  log.warn(`${signal} received — shutting down gracefully`);

  // Stop accepting new connections
  httpServer.close(() => {
    log.info('HTTP server closed');
  });

  // Close all socket connections
  if (io) {
    io.close(() => {
      log.info('Socket.IO server closed');
    });
  }

  // Disconnect Redis
  await disconnectRedis();

  log.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
  process.exit(1);
});

// ─── Start ────────────────────────────────────────────────────────────────────

bootstrap().catch((err: Error) => {
  logger.error(`Bootstrap failed: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
