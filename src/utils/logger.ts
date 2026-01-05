import pino, { type Bindings, type LevelWithSilent } from 'pino';

enum LogLevel {
    DEBUG = 'debug',
    INFO = 'info',
    WARN = 'warn',
    ERROR = 'error',
}

function getLogLevel(): LogLevel {
    const nodeEnv = process.env.NODE_ENV?.toLowerCase();

    switch (nodeEnv) {
        case 'production':
            return LogLevel.INFO;
        case 'development':
            return LogLevel.DEBUG;
        default:
            return LogLevel.DEBUG;
    }
}

function shouldUsePrettyPrint(): boolean {
    const isStdioMode = !process.argv.includes('--http');
    if (isStdioMode) {
        return false;
    }
    return process.env.NODE_ENV !== 'production';
}

function createLoggerConfig(): pino.LoggerOptions {
    const baseConfig: pino.LoggerOptions = {
        level: getLogLevel(),
        formatters: {
            level: (label: LevelWithSilent | string) => ({ level: String(label).toUpperCase() }),
            bindings: (bindings: Bindings) => ({
                pid: bindings.pid,
                host: bindings.hostname,
            }),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
        base: {
            env: process.env.NODE_ENV || 'development',
        },
    };

    if (shouldUsePrettyPrint()) {
        baseConfig.transport = {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
                ignore: 'pid,hostname,env',
                singleLine: false,
                errorLikeObjectKeys: ['err', 'error'],
                destination: 2, // stderr
            },
        };
    }

    return baseConfig;
}

const logger: pino.Logger = pino(createLoggerConfig(), process.stderr);

class AppLogger {
    private logger: pino.Logger;

    constructor(loggerInstance: pino.Logger = logger) {
        this.logger = loggerInstance;
    }

    debug(obj: object | string, msg?: string): void {
        if (typeof obj === 'string') {
            this.logger.debug(obj);
        } else {
            this.logger.debug(obj, msg);
        }
    }

    info(obj: object | string, msg?: string): void {
        if (typeof obj === 'string') {
            this.logger.info(obj);
        } else {
            this.logger.info(obj, msg);
        }
    }

    warn(obj: object | string, msg?: string): void {
        if (typeof obj === 'string') {
            this.logger.warn(obj);
        } else {
            this.logger.warn(obj, msg);
        }
    }

    error(obj: object | string, msg?: string): void {
        if (typeof obj === 'string') {
            this.logger.error(obj);
        } else {
            this.logger.error(obj, msg);
        }
    }

    child(bindings: object): AppLogger {
        return new AppLogger(this.logger.child(bindings));
    }

    getLevel(): string {
        return this.logger.level;
    }
}

const appLogger = new AppLogger(logger);

export default appLogger;
