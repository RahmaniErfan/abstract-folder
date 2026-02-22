/**
 * @file types.ts
 * @description Shared types and interfaces for the sync engine.
 * Designed for polymorphic reuse across Engine 1 (private vault) and Engine 2 (public CDN).
 */

// ─── Sync Engine Lifecycle ──────────────────────────────────────────

/**
 * Core interface for any sync engine.
 * Engine 1: start() begins auto-commit + network queue.
 * Engine 2: start() initializes CDN polling; flush() is a no-op.
 */
export interface ISyncEngine {
    start(): void;
    stop(): void;
    /** Flush all pending operations (e.g., commit dirty files before app close). */
    flush(): Promise<void>;
}

// ─── Event Bus ──────────────────────────────────────────────────────

export type SyncEventType =
    | 'commit'           // Local commit made
    | 'push-start'       // Network push starting
    | 'push-complete'    // Network push done
    | 'push-skipped'     // Smart Push gate: nothing to push
    | 'pull-complete'    // Network pull done
    | 'conflict'         // Conflicts detected
    | 'merge-complete'   // Merge resolved
    | 'error'            // Recoverable error
    | 'auth-error'       // PAT expired (401)
    | 'offline'          // Network unreachable
    | 'large-file';      // File exceeds size threshold

export interface SyncEvent {
    type: SyncEventType;
    detail?: any;
}

export type SyncEventListener = (event: SyncEvent) => void;

// ─── Conflict Types ─────────────────────────────────────────────────

export interface ConflictFile {
    path: string;
    type: 'text' | 'binary' | 'delete-modify' | 'rename-modify';
}

export interface ConflictDetectionResult {
    hasConflicts: boolean;
    files: ConflictFile[];
    canFastForward: boolean;
}

// ─── Error Classification ───────────────────────────────────────────

export type NetworkErrorKind =
    | 'offline'
    | 'auth-expired'
    | 'rate-limited'
    | 'repo-not-found'
    | 'unknown';

// ─── Git Author ─────────────────────────────────────────────────────

export interface SyncAuthor {
    name: string;
    email: string;
}

// ─── Constants ──────────────────────────────────────────────────────

/** Debounce interval for auto-commit (ms). */
export const AUTO_COMMIT_DEBOUNCE_MS = 5_000;

/** Network sync interval (ms). */
export const NETWORK_SYNC_INTERVAL_MS = 60_000;

/** Maximum file size for auto-commit (bytes). 50 MB. */
export const MAX_AUTO_COMMIT_FILE_SIZE = 50 * 1024 * 1024;

/** Git GC interval — run at most once per 7 days. */
export const GC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
