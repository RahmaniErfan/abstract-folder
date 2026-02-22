/**
 * @file sync-orchestrator.ts
 * @description Top-level coordinator that wires and manages all 4 sync components.
 *
 * Uses dependency injection so Engine 2 can swap components:
 * - Engine 1: AutoCommitEngine + NetworkSyncQueue + ConflictDetector + MergeResolver
 * - Engine 2: CDNPollEngine + CacheManager (future, same ISyncEngine interface)
 *
 * Responsibilities:
 * - Lifecycle: start/stop all components
 * - Flush: drain auto-commit + final push on app close
 * - Event aggregation: forwards all component events
 * - GC: fire-and-forget weekly git gc --auto
 * - Crash recovery: check MERGE_HEAD on boot
 */

import { App } from 'obsidian';
import { ISyncEngine, SyncEvent, SyncEventListener, SyncEventType, SyncAuthor, GC_INTERVAL_MS } from './types';
import { Mutex } from './mutex';
import { GitCommandRunner } from './git-command-runner';
import { AutoCommitEngine } from './auto-commit-engine';
import { NetworkSyncQueue } from './network-sync-queue';
import { ConflictDetector } from './conflict-detector';
import { MergeResolver, OpenMergeUIFn } from './merge-resolver';
import { toPosixDir } from './path-utils';

export interface SyncOrchestratorConfig {
    app: App;
    absoluteDir: string;
    branch: string;
    mutex: Mutex;
    getToken: () => Promise<string | undefined>;
    getAuthor: () => SyncAuthor;
    openMergeUI: OpenMergeUIFn;
    /** Timestamp of last git gc (from settings). */
    lastGcTime?: number;
    /** Callback to persist lastGcTime to settings. */
    onGcRun?: (timestamp: number) => void;
}

export class SyncOrchestrator implements ISyncEngine {
    private autoCommit: AutoCommitEngine;
    private networkQueue: NetworkSyncQueue;
    private conflictDetector: ConflictDetector;
    private mergeResolver: MergeResolver;
    private runner: GitCommandRunner;
    private listeners: Map<string, Set<SyncEventListener>> = new Map();
    private unsubscribers: Array<() => void> = [];
    private running = false;
    private _isPausedForConflict = false;

    // Config
    private absoluteDir: string;
    private branch: string;

    constructor(private config: SyncOrchestratorConfig) {
        this.absoluteDir = toPosixDir(config.absoluteDir);
        this.branch = config.branch;

        // ─── Build Components ───────────────────────────────────
        this.runner = new GitCommandRunner(this.absoluteDir, config.getToken);

        this.autoCommit = new AutoCommitEngine(
            config.app,
            this.absoluteDir,
            this.runner,
            config.mutex,
            config.getAuthor,
            () => this.isPausedForConflict,
        );

        this.conflictDetector = new ConflictDetector(this.runner);

        this.mergeResolver = new MergeResolver(
            config.app,
            this.absoluteDir,
            this.runner,
            config.getAuthor,
            config.openMergeUI,
        );

        this.networkQueue = new NetworkSyncQueue(
            this.runner,
            config.mutex,
            this.branch,
            // Conflict check callback
            () => this.conflictDetector.detect(),
            // Merge resolve callback
            (result) => this.mergeResolver.resolve(result),
            () => this.isPausedForConflict,
        );

        // ─── Wire Events ────────────────────────────────────────
        // Forward all component events through the orchestrator's event bus
        this.unsubscribers.push(
            this.autoCommit.on('*', (e) => this.emit(e)),
            this.networkQueue.on('*', (e) => this.emit(e)),
        );

        // Link isMerging flag between MergeResolver and AutoCommitEngine
        // MergeResolver sets isMerging, AutoCommitEngine checks it
        const originalResolve = this.mergeResolver.resolve.bind(this.mergeResolver);
        this.mergeResolver.resolve = async (result) => {
            this.setPaused(true);
            this.autoCommit.isMerging = true;
            try {
                await originalResolve(result);
            } finally {
                this.autoCommit.isMerging = false;
                this.setPaused(false);
            }
        };
    }

    // ─── ISyncEngine Lifecycle ──────────────────────────────────

    start(): void {
        if (this.running) return;
        this.running = true;

        this.autoCommit.start();
        this.networkQueue.start();

        console.log(`[SyncOrchestrator] Started for ${this.absoluteDir} (branch: ${this.branch})`);
    }

    stop(): void {
        if (!this.running) return;
        this.running = false;

        this.autoCommit.stop();
        this.networkQueue.stop();

        // Cleanup event subscriptions
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];

        console.log(`[SyncOrchestrator] Stopped for ${this.absoluteDir}`);
    }

    /**
     * Flush: drain auto-commit then do one final push.
     * Called from plugin.onunload() — must complete before process dies.
     */
    async flush(): Promise<void> {
        console.log(`[SyncOrchestrator] Flushing ${this.absoluteDir}...`);

        // 1. Flush all pending auto-commits
        await this.autoCommit.flush();

        // 2. One final network push
        await this.networkQueue.flush();

        console.log(`[SyncOrchestrator] Flush complete for ${this.absoluteDir}`);
    }

    /**
     * Orchestrator Lock: Pauses background engines during UI-active conflicts.
     * Prevents UI recursion and HEAD moving targets.
     */
    public get isPausedForConflict(): boolean {
        return this._isPausedForConflict;
    }

    private setPaused(paused: boolean): void {
        this._isPausedForConflict = paused;
        if (!paused && this.running) {
            // Instantly resume and distribute the resolution
            void this.networkQueue.pushNow();
        }
    }

    // ─── Public API ─────────────────────────────────────────────

    /** Manual push from UI. */
    async pushNow(): Promise<void> {
        // First, flush any pending auto-commits so they get pushed
        await this.autoCommit.flush();
        await this.networkQueue.pushNow();
    }

    /** Unhalt the network queue after PAT update. */
    resetAuth(): void {
        this.networkQueue.resetAuth();
    }

    /** Whether the network queue is halted due to auth error. */
    get isAuthHalted(): boolean {
        return this.networkQueue.isAuthHalted;
    }

    /** Timestamp of last successful push. */
    get lastPush(): number {
        return this.networkQueue.lastPush;
    }

    // ─── Crash Recovery ─────────────────────────────────────────

    /**
     * Check for and recover from a crashed merge.
     * Should be called once on plugin boot, BEFORE starting the engine.
     */
    async recoverIfNeeded(): Promise<boolean> {
        return this.mergeResolver.recoverCrashedMerge();
    }

    // ─── Git GC ─────────────────────────────────────────────────

    /**
     * Fire-and-forget git gc --auto.
     * NEVER awaited — runs as a detached background operation.
     * Only runs if > 7 days since last gc.
     */
    gcIfNeeded(): void {
        const lastGc = this.config.lastGcTime || 0;
        const now = Date.now();

        if (now - lastGc < GC_INTERVAL_MS) {
            return; // Not due yet
        }

        console.log(`[SyncOrchestrator] Running git gc --auto (last run: ${new Date(lastGc).toISOString()})`);
        this.runner.gc();

        // Persist the timestamp
        if (this.config.onGcRun) {
            this.config.onGcRun(now);
        }
    }

    // ─── Event Bus ──────────────────────────────────────────────

    on(type: SyncEventType | '*', listener: SyncEventListener): () => void {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type)!.add(listener);
        return () => this.listeners.get(type)?.delete(listener);
    }

    private emit(event: SyncEvent): void {
        // Specific type listeners
        const typeListeners = this.listeners.get(event.type);
        if (typeListeners) {
            typeListeners.forEach(l => {
                try { l(event); } catch (e) { console.error('[SyncOrchestrator] Listener error:', e); }
            });
        }
        // Wildcard listeners
        const allListeners = this.listeners.get('*');
        if (allListeners) {
            allListeners.forEach(l => {
                try { l(event); } catch (e) { console.error('[SyncOrchestrator] Listener error:', e); }
            });
        }
    }
}
