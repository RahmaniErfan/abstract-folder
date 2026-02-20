export interface LogEntry {
    timestamp: string;
    level: "debug" | "info" | "warn" | "error";
    message: string;
    data?: unknown;
}

const MAX_LOGS = 1000;
const logBuffer: LogEntry[] = [];

const SENSITIVE_KEYS = ["githubToken", "token", "password", "secret"];

function redactSensitiveData(data: unknown, depth = 0, visited = new WeakSet()): unknown {
    if (!data || depth > 3) return data; // Depth limit to prevent stack overflow

    if (typeof data === "string") {
        // Redact anything that looks like a GitHub token pattern if it's broad
        if (data.startsWith("ghp_") || data.startsWith("github_pat_")) {
            return "[redacted token]";
        }
        return data;
    }

    if (typeof data === "object" && data !== null) {
        // Prevent circular references
        if (visited.has(data)) return "[circular]";
        visited.add(data);

        if (Array.isArray(data)) {
            return data.map(item => redactSensitiveData(item, depth + 1, visited));
        }

        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
            if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k))) {
                result[key] = "[redacted]";
            } else {
                result[key] = redactSensitiveData(value, depth + 1, visited);
            }
        }
        return result;
    }
    return data;
}

let isLogging = false;

export function logToBuffer(level: LogEntry["level"], message: string, data?: unknown) {
    if (isLogging) return;
    isLogging = true;

    try {
        // Redact sensitive info from message and data
        const safeMessage = redactSensitiveData(message) as string;
        const safeData = redactSensitiveData(data);

        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message: safeMessage,
            data: safeData
        };
        logBuffer.push(entry);
        if (logBuffer.length > MAX_LOGS) {
            logBuffer.shift();
        }
        
        // Avoid double prefix if the message already starts with [Abstract Folder]
        const prefix = "[Abstract Folder]";
        const consoleMsg = message.startsWith(prefix) ? message : `${prefix} ${message}`;
        const args = safeData !== undefined ? [consoleMsg, safeData] : [consoleMsg];

        if (level === "debug") {
            window.console.debug(...args);
        } else if (level === "info") {
            window.console.log(...args); // Use .log for info to distinguish from .debug
        } else if (level === "warn") {
            window.console.warn(...args);
        } else if (level === "error") {
            window.console.error(...args);
        }
    } finally {
        isLogging = false;
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
