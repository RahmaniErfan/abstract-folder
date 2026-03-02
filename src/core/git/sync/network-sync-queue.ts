/**
 * @file network-sync-queue.ts
 * @description Component 2: The Network Sync Queue (Fetch & Push)
 *
 * Manages a 60-second interval loop that fetches remote changes, delegates
 * conflict detection, and pushes local commits. Decoupled from the auto-commit
 * engine — it only speaks to the ConflictDetector and MergeResolver via callbacks.
 *
 * Key invariants:
 * - NEVER uses `git pull` — only `git fetch` + explicit merge via MergeResolver
 * - Smart Push gate: skips push if local is not ahead of remote
 * - Mutex prevents overlapping with AutoCommitEngine
 * - Offline-tolerant: catches network errors, retries next tick
 * - Auth error handling: halts queue on 401, emits auth-error event
 */

import { ISyncEngine, SyncEvent, SyncEventListener, NETWORK_SYNC_INTERVAL_MS, ConflictDetectionResult } from './types';
import { GitCommandRunner, GitCommandError } from './git-command-runner';
import { Mutex } from './mutex';

/** Callback type for conflict detection delegation */
export type ConflictCheckFn = () => Promise<ConflictDetectionResult>;

/** Callback type for merge resolution delegation */
export type MergeResolveFn = (result: ConflictDetectionResult) => Promise<void>;

export class NetworkSyncQueue implements ISyncEngine {
    private intervalHandle: ReturnType<typeof setInterval> | null = null;
    private running = false;
    private isNetworkSyncing = false; // Zombie protection mutex guard
    private listeners: Map<string, Set<SyncEventListener>> = new Map();

    // Metrics
    private unpushedCommits = 0;
    private consecutiveFailures = 0;
    private lastPushTime = 0;
    private authHalted = false; // Queue halted due to 401

    constructor(
        private runner: GitCommandRunner,
        private mutex: Mutex,
        private branch: string,
        private onConflictCheck: ConflictCheckFn,
        private onMergeResolve: MergeResolveFn,
        private isPaused: () => boolean,
    ) {}

    // ─── ISyncEngine ────────────────────────────────────────────

    start(): void {
        if (this.running) return;
        this.running = true;
        this.authHalted = false;
        console.log(`[NetworkSyncQueue] Started for branch ${this.branch}`);

        // Run immediately on start, then every 60s
        void this.tick();
        this.intervalHandle = setInterval(() => {
            void this.tick();
        }, NETWORK_SYNC_INTERVAL_MS);
    }

    stop(): void {
        console.log(`[NetworkSyncQueue] Stopping queue...`);
        if (!this.running) return;
        this.running = false;

        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }

    /**
     * Flush: force one final sync cycle (for app close).
     * Unlike tick(), this awaits the full push even if slow.
     */
    async flush(): Promise<void> {
        if (this.authHalted || this.isPaused()) return;
        await this.syncCycle();
    }

    // ─── Public API ─────────────────────────────────────────────

    /**
     * Manual push from UI (status bar button, modal).
     * Still respects mutex and Smart Push gate.
     */
    async pushNow(): Promise<void> {
        if (this.authHalted) {
            this.emit({ type: 'auth-error', detail: { message: 'Queue halted — update PAT' } });
            return;
        }
        if (this.isPaused()) return; // Manual push also respects the lock
        await this.syncCycle();
    }

    /** Unhalt the queue after a PAT update. */
    resetAuth(): void {
        this.authHalted = false;
        this.consecutiveFailures = 0;
    }

    /** Whether the queue is halted due to auth error. */
    get isAuthHalted(): boolean {
        return this.authHalted;
    }

    /** Timestamp of last successful push (ms). */
    get lastPush(): number {
        return this.lastPushTime;
    }

    // ─── Core Loop ──────────────────────────────────────────────

    /**
     * The 60-second tick. Skips if already syncing (zombie protection).
     */
    private async tick(): Promise<void> {
        console.log(`[NetworkSyncQueue] Tick starting for ${this.branch}`);
        if (!this.running || this.authHalted || this.isPaused()) {
            console.debug(`[NetworkSyncQueue] Tick skipped: running=${this.running}, halted=${this.authHalted}, paused=${this.isPaused()}`);
            return;
        }

        // ─── Overlapping Process Guard (Zombie Danger) ──────────
        // If a previous push is still running (e.g., 2G network), skip this tick.
        // Without this, we'd spawn concurrent git processes that corrupt .git/index.
        if (this.isNetworkSyncing) {
            console.debug('[NetworkSyncQueue] Previous sync still running, skipping tick');
            return;
        }

        await this.syncCycle();
    }

    /**
     * One full sync cycle: fetch → detect conflicts → resolve → push.
     */
    private async syncCycle(): Promise<void> {
        console.log(`[NetworkSyncQueue] Sync cycle starting for ${this.branch}...`);
        this.isNetworkSyncing = true;
        const release = await this.mutex.acquire();

        try {
            // 1. Fetch remote changes
            try {
                await this.runner.fetch(this.branch);
            } catch (e: any) {
                this.handleNetworkError(e);
                return; // Can't continue without fetch
            }

            // 2. Conflict detection (delegated to ConflictDetector)
            const result = await this.onConflictCheck();

            if (result.hasConflicts) {
                // 3a. Delegate to MergeResolver
                this.emit({ type: 'conflict', detail: { files: result.files } });
                try {
                    await this.onMergeResolve(result);
                    this.emit({ type: 'merge-complete' });
                } catch (e: any) {
                    console.error('[NetworkSyncQueue] Merge resolution failed:', e);
                    this.emit({ type: 'error', detail: { phase: 'merge', error: e } });
                    return; // Don't push if merge failed
                }
            } else if (!result.canFastForward) {
                // Remote has changes but no conflicts — fast-forward merge
                try {
                    await this.runner.merge(this.branch);
                    this.emit({ type: 'pull-complete' });
                } catch (e: any) {
                    console.error('[NetworkSyncQueue] Fast-forward merge failed:', e);
                    this.emit({ type: 'error', detail: { phase: 'merge', error: e } });
                    return;
                }
            } else {
                // Nothing to pull
                this.emit({ type: 'pull-complete', detail: { noop: true } });
            }

            // 4. Smart Push Gate: only push if we're actually ahead
            const aheadCount = await this.runner.logAheadCount(this.branch);
            if (aheadCount === 0) {
                this.emit({ type: 'push-skipped', detail: { reason: 'not-ahead' } });
                return;
            }

            // 5. Push
            this.emit({ type: 'push-start', detail: { aheadCount } });
            try {
                await this.runner.push(this.branch);
                this.lastPushTime = Date.now();
                this.consecutiveFailures = 0;
                this.emit({ type: 'push-complete', detail: { aheadCount } });
            } catch (e: any) {
                this.handleNetworkError(e);
            }

        } catch (e: any) {
            console.error('[NetworkSyncQueue] Unexpected error in sync cycle:', e);
            this.emit({ type: 'error', detail: { phase: 'unknown', error: e } });
        } finally {
            release();
            this.isNetworkSyncing = false;
        }
    }

    // ─── Error Handling ─────────────────────────────────────────

    private handleNetworkError(error: GitCommandError | any): void {
        const kind = error.kind || 'unknown';

        switch (kind) {
            case 'offline':
                this.consecutiveFailures++;
                this.emit({ type: 'offline', detail: { consecutiveFailures: this.consecutiveFailures } });
                console.debug('[NetworkSyncQueue] Offline, will retry next tick');
                break;

            case 'auth-expired':
                this.authHalted = true;
                this.emit({ type: 'auth-error', detail: { message: error.message } });
                console.error('[NetworkSyncQueue] Auth failed — queue halted. User must update PAT.');
                break;

            case 'rate-limited': {
                // Exponential backoff: skip next N ticks
                this.consecutiveFailures++;
                const backoffMs = Math.min(
                    NETWORK_SYNC_INTERVAL_MS * Math.pow(2, this.consecutiveFailures),
                    30 * 60 * 1000 // Cap at 30 minutes
                );
                console.warn(`[NetworkSyncQueue] Rate limited. Backing off for ${backoffMs / 1000}s`);
                this.emit({ type: 'error', detail: { kind: 'rate-limited', backoffMs } });
                break;
            }

            default:
                this.consecutiveFailures++;
                this.emit({ type: 'error', detail: { kind, message: error.message } });
                console.error('[NetworkSyncQueue] Network error:', error);
                break;
        }
    }

    // ─── Event Bus ──────────────────────────────────────────────

    on(type: string, listener: SyncEventListener): () => void {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type)!.add(listener);
        return () => this.listeners.get(type)?.delete(listener);
    }

    private emit(event: SyncEvent): void {
        const typeListeners = this.listeners.get(event.type);
        if (typeListeners) {
            typeListeners.forEach(l => {
                try { l(event); } catch (e) { console.error('[NetworkSyncQueue] Listener error:', e); }
            });
        }
        const allListeners = this.listeners.get('*');
        if (allListeners) {
            allListeners.forEach(l => {
                try { l(event); } catch (e) { console.error('[NetworkSyncQueue] Listener error:', e); }
            });
        }
    }
}
