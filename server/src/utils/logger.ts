import winston from 'winston';
import { config } from '../config';

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} [${level}] ${stack ?? message}${metaStr}`;
  }),
);

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

export const logger = winston.createLogger({
  level: config.log.level,
  format: config.isProduction ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
  exitOnError: false,
});

/** Creates a child logger scoped to a specific module */
export function createModuleLogger(module: string): winston.Logger {
  return logger.child({ module });
}
