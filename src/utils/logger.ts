export interface LogEntry {
    timestamp: string;
    level: "debug" | "info" | "warn" | "error";
    message: string;
    data?: unknown;
}

const MAX_LOGS = 1000;
const logBuffer: LogEntry[] = [];

export function logToBuffer(level: LogEntry["level"], message: string, data?: unknown) {
    const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        data
    };
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOGS) {
        logBuffer.shift();
    }
    
    // Avoid double prefix if the message already starts with [Abstract Folder]
    const prefix = "[Abstract Folder]";
    const consoleMsg = message.startsWith(prefix) ? message : `${prefix} ${message}`;
    const args = data !== undefined ? [consoleMsg, data] : [consoleMsg];

    if (level === "debug") {
        window.console.debug(...args);
    } else if (level === "info") {
        window.console.log(...args); // Use .log for info to distinguish from .debug
    } else if (level === "warn") {
        window.console.warn(...args);
    } else if (level === "error") {
        window.console.error(...args);
    }
}

export function getLogs(): LogEntry[] {
    return [...logBuffer];
}

export const Logger = {
    debug: (msg: string, data?: unknown) => logToBuffer("debug", msg, data),
    info: (msg: string, data?: unknown) => logToBuffer("info", msg, data),
    warn: (msg: string, data?: unknown) => logToBuffer("warn", msg, data),
    error: (msg: string, data?: unknown) => logToBuffer("error", msg, data),
};
