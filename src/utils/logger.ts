/**
 * Centralized Logger Utility
 *
 * Provides structured logging with configurable levels (DEBUG, INFO, WARN, ERROR).
 * Defaults to INFO level in production to reduce console noise.
 *
 * To enable debug logs in the browser console:
 * localStorage.setItem('LOG_LEVEL', 'DEBUG')
 * and reload the page (or it takes effect immediately).
 */

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

class LoggerService {
    private defaultLevel: LogLevel = LogLevel.INFO;

    /**
     * Gets the current log level, dynamically reading from localStorage
     * This ensures changes take effect immediately without needing module reload
     */
    private getLevel(): LogLevel {
        if (typeof window === 'undefined') {
            return this.defaultLevel;
        }

        try {
            const savedLevel = localStorage.getItem('LOG_LEVEL');
            if (savedLevel) {
                switch (savedLevel.toUpperCase()) {
                    case 'DEBUG': return LogLevel.DEBUG;
                    case 'INFO': return LogLevel.INFO;
                    case 'WARN': return LogLevel.WARN;
                    case 'ERROR': return LogLevel.ERROR;
                }
            }
        } catch (e) {
            // Ignore localStorage errors
        }

        return this.defaultLevel;
    }

    public setDefaultLevel(level: LogLevel) {
        this.defaultLevel = level;
    }

    private shouldLog(level: LogLevel): boolean {
        return level >= this.getLevel();
    }

    private formatMessage(context: string, message: string): string {
        const time = new Date().toISOString().split('T')[1].slice(0, 8); // HH:MM:SS
        return `[${time}] [${context}] ${message}`;
    }

    debug(context: string, message: string, ...args: any[]) {
        if (this.shouldLog(LogLevel.DEBUG)) {
            console.debug(this.formatMessage(context, message), ...args);
        }
    }

    info(context: string, message: string, ...args: any[]) {
        if (this.shouldLog(LogLevel.INFO)) {
            console.info(this.formatMessage(context, message), ...args);
        }
    }

    warn(context: string, message: string, ...args: any[]) {
        if (this.shouldLog(LogLevel.WARN)) {
            console.warn(this.formatMessage(context, message), ...args);
        }
    }

    error(context: string, message: string, ...args: any[]) {
        if (this.shouldLog(LogLevel.ERROR)) {
            console.error(this.formatMessage(context, message), ...args);
        }
    }
}

export const Logger = new LoggerService();
