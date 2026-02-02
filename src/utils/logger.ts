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
    
    // Also output to console for standard dev tools
    const consoleMsg = `[Abstract Folder] ${message}`;
    switch (level) {
        case "debug": console.debug(consoleMsg, data ?? ""); break;
        case "info": console.debug(consoleMsg, data ?? ""); break; // info is not allowed in eslint config, using debug
        case "warn": console.warn(consoleMsg, data ?? ""); break;
        case "error": console.error(consoleMsg, data ?? ""); break;
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
