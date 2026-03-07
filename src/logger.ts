import pino, {
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
  type LoggerOptions,
} from 'pino';

const DEFAULT_SERVICE = 'cetus-peg-watcher';

function shouldUsePrettyLogs(): boolean {
  const raw = (process.env.LOG_PRETTY || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function resolveDefaultLevel(): LevelWithSilent {
  const level = (process.env.LOG_LEVEL || 'info').trim().toLowerCase();
  const allowed: LevelWithSilent[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
  return allowed.includes(level as LevelWithSilent) ? (level as LevelWithSilent) : 'info';
}

function createPrettyTransport() {
  return pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      singleLine: true,
    },
  });
}

export interface CreateLoggerOptions {
  service?: string;
  level?: LevelWithSilent;
  destination?: DestinationStream;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level || resolveDefaultLevel(),
    base: {
      service: options.service || DEFAULT_SERVICE,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
  };

  if (options.destination) {
    return pino(loggerOptions, options.destination);
  }

  if (shouldUsePrettyLogs()) {
    return pino(loggerOptions, createPrettyTransport());
  }

  return pino(loggerOptions);
}

export function createModuleLogger(module: string, baseLogger: Logger = logger): Logger {
  return baseLogger.child({ module });
}

export function toLogError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'string') {
    return new Error(error);
  }

  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

export const logger = createLogger();
