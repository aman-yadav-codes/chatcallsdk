import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ─── Project Config ───────────────────────────────────────────────────────────

export interface ProjectConfig {
  projectId: string;
  apiKey: string;
  jwtSecret: string;
}

function parseProjects(): ProjectConfig[] {
  const raw = process.env.PROJECTS;
  if (!raw) {
    throw new Error('PROJECTS environment variable is required');
  }
  try {
    const parsed = JSON.parse(raw) as ProjectConfig[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('PROJECTS must be a non-empty JSON array');
    }
    for (const p of parsed) {
      if (!p.projectId || !p.apiKey || !p.jwtSecret) {
        throw new Error(`Project config missing required fields: ${JSON.stringify(p)}`);
      }
    }
    return parsed;
  } catch (err) {
    throw new Error(`Failed to parse PROJECTS env var: ${(err as Error).message}`);
  }
}

// ─── Configuration Object ─────────────────────────────────────────────────────

export const config = {
  // Server
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // CORS
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : ['*'],

  // Redis — supports full URL (Upstash / Redis Cloud / self-hosted)
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'rtc:',
    tls: process.env.REDIS_URL?.startsWith('rediss://') ?? false,
    ttl: {
      message: parseInt(process.env.MESSAGE_TTL_SECONDS ?? '604800', 10),   // 7 days
      call: parseInt(process.env.CALL_TTL_SECONDS ?? '300', 10),             // 5 min
      presence: parseInt(process.env.PRESENCE_TTL_SECONDS ?? '60', 10),     // 60 sec
      notification: parseInt(process.env.NOTIFICATION_TTL_SECONDS ?? '86400', 10), // 24h
    },
  },

  // Projects (multi-tenant)
  projects: parseProjects(),

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    maxEvents: parseInt(process.env.RATE_LIMIT_MAX_EVENTS ?? '120', 10),
  },

  // Heartbeat
  heartbeat: {
    intervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? '25000', 10),
    timeoutMs: parseInt(process.env.HEARTBEAT_TIMEOUT_MS ?? '60000', 10),
  },

  // Calls
  calls: {
    ringingTimeoutMs: parseInt(process.env.CALL_RING_TIMEOUT_MS ?? '60000', 10),
  },

  // Typing
  typing: {
    autoStopMs: parseInt(process.env.TYPING_AUTO_STOP_MS ?? '5000', 10),
  },

  // Logging
  log: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
} as const;

// Build a projectId → config map for O(1) lookups
export const projectMap = new Map<string, ProjectConfig>(
  config.projects.map((p) => [p.projectId, p]),
);

export function getProject(projectId: string): ProjectConfig | undefined {
  return projectMap.get(projectId);
}
