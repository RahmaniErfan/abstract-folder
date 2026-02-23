/**
 * @file public-sync-orchestrator.ts
 * @description Engine 2 top-level coordinator for public library sync.
 *
 * Wires the three Engine 2 components:
 * 1. CDNManifestPoller → detects remote updates via lightweight CDN polling
 * 2. VersionController → validates SemVer + downgrade protection
 * 3. ShallowSyncExecutor → applies updates via shallow fetch + hard reset
 *
 * Implements ISyncEngine for lifecycle compatibility with SyncManager.
 * flush() is a no-op — Engine 2 is strictly read-only (nothing to push).
 *
 * Desktop-only: relies on GitCommandRunner (child_process).
 */

import { App } from 'obsidian';
import { ISyncEngine, SyncEvent, SyncEventListener, SyncEventType } from './types';
import { Mutex } from './mutex';
import { GitCommandRunner } from './git-command-runner';
import { CDNManifestPoller, ManifestData } from './cdn-manifest-poller';
import { VersionController, VersionCheckResult } from './version-controller';
import { ShallowSyncExecutor, ShallowSyncExecutorConfig } from './shallow-sync-executor';
import { toPosixDir } from './path-utils';

// ─── Config ─────────────────────────────────────────────────────────

export interface PublicSyncConfig {
    app: App;
    absoluteDir: string;
    vaultPath: string;
    repositoryUrl: string;
    branch: string;
    getToken: () => Promise<string | undefined>;
    /** Read the locally persisted version for this library. */
    getLocalVersion: () => string;
    /** Persist the new version after successful sync. */
    setLocalVersion: (version: string) => void;
    /** Optional: sparse checkout folders. */
    subscribedFolders?: string[];
    /** Timestamp of last gc --prune=now. */
    lastGcTime?: number;
    /** Callback to persist lastGcTime. */
    onGcRun?: (timestamp: number) => void;
}

// ─── Public Sync Orchestrator ───────────────────────────────────────

export class PublicSyncOrchestrator implements ISyncEngine {
    private poller: CDNManifestPoller;
    private versionCtrl: VersionController;
    private executor: ShallowSyncExecutor;
    private runner: GitCommandRunner;
    private mutex: Mutex;

    private listeners: Map<string, Set<SyncEventListener>> = new Map();
    private unsubscribers: Array<() => void> = [];
    private running = false;
    private isSyncing = false; // Guard against overlapping syncs

    // Config
    private absoluteDir: string;
    private branch: string;

    constructor(private config: PublicSyncConfig) {
        this.absoluteDir = toPosixDir(config.absoluteDir);
        this.branch = config.branch;
        this.mutex = new Mutex();

        // ─── Build Components ───────────────────────────────────
        this.runner = new GitCommandRunner(this.absoluteDir, config.getToken);

        this.versionCtrl = new VersionController(
            config.getLocalVersion,
            config.setLocalVersion,
        );

        this.executor = new ShallowSyncExecutor({
            app: config.app,
            absoluteDir: this.absoluteDir,
            vaultPath: config.vaultPath,
            runner: this.runner,
            mutex: this.mutex,
            branch: this.branch,
            subscribedFolders: config.subscribedFolders,
            lastGcTime: config.lastGcTime,
            onGcRun: config.onGcRun,
        });

        this.poller = new CDNManifestPoller(
            config.repositoryUrl,
            this.branch,
            (manifest) => this.onManifestReceived(manifest),
        );

        // ─── Wire Events ────────────────────────────────────────
        // Forward all component events through the orchestrator's event bus
        this.unsubscribers.push(
            this.poller.on('*', (e) => this.emit(e)),
            this.executor.on('*', (e) => this.emit(e)),
        );
    }

    // ─── ISyncEngine Lifecycle ──────────────────────────────────

    async start(): Promise<boolean> {
        if (this.running) return true;

        // Pre-flight check: ensure directory exists
        try {
            const { stat } = require('fs/promises');
            await stat(this.absoluteDir);
        } catch {
            console.error(`[PublicSyncOrchestrator] Cannot start: directory missing: ${this.absoluteDir}`);
            return false;
        }

        this.running = true;
        this.poller.start();

        console.log(`[PublicSyncOrchestrator] Started for ${this.absoluteDir} (repo: ${this.config.repositoryUrl})`);
        return true;
    }

    stop(): void {
        if (!this.running) return;
        this.running = false;

        this.poller.stop();

        // Cleanup event subscriptions
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];

        console.log(`[PublicSyncOrchestrator] Stopped for ${this.absoluteDir}`);
    }

    /**
     * No-op for Engine 2 — read-only, nothing to push or commit.
     */
    async flush(): Promise<void> {}

    // ─── Public API ─────────────────────────────────────────────

    /**
     * Manual sync from UI. Bypasses CDN poll interval.
     * Shows toast about CDN cache propagation delay (~5 minutes).
     */
    async syncNow(): Promise<void> {
        if (this.isSyncing) {
            console.debug('[PublicSyncOrchestrator] Sync already in progress, dropping duplicate request');
            return;
        }

        const manifest = await this.poller.checkNow();
        if (manifest) {
            await this.onManifestReceived(manifest);
        }
    }

    /** Current locally synced version. */
    get currentVersion(): string {
        return this.versionCtrl.currentVersion;
    }

    // ─── Core Logic ─────────────────────────────────────────────

    /**
     * Called when CDN poller receives a manifest (either from timer or manual check).
     * Validates version, then executes shallow sync if update is available.
     */
    private async onManifestReceived(manifest: ManifestData): Promise<void> {
        if (this.isSyncing) return; // Drop if already syncing

        // Version check
        const check: VersionCheckResult = this.versionCtrl.shouldUpdate(manifest);

        if (!check.shouldUpdate) {
            console.debug(`[PublicSyncOrchestrator] No update needed: ${check.reason} (local: ${check.localVersion}, remote: ${check.remoteVersion})`);
            if (check.reason === 'up-to-date') {
                this.emit({ type: 'update-skipped', detail: { reason: check.reason } });
            }
            return;
        }

        // Update available — execute shallow sync
        console.log(`[PublicSyncOrchestrator] Update available: ${check.localVersion} → ${check.remoteVersion} (${check.reason})`);
        this.emit({
            type: 'update-available',
            detail: {
                localVersion: check.localVersion,
                remoteVersion: check.remoteVersion,
                reason: check.reason,
            },
        });

        this.isSyncing = true;
        try {
            const result = await this.executor.execute();

            if (result.updated) {
                // Persist the new version
                this.versionCtrl.applyVersion(manifest.version);

                // Fire-and-forget GC
                this.executor.gcIfNeeded();
            }
        } catch (e: any) {
            console.error('[PublicSyncOrchestrator] Sync cycle failed:', e);
            this.emit({ type: 'error', detail: { phase: 'orchestrator', error: e.message } });
        } finally {
            this.isSyncing = false;
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
        const typeListeners = this.listeners.get(event.type);
        if (typeListeners) {
            typeListeners.forEach(l => {
                try { l(event); } catch (e) { console.error('[PublicSyncOrchestrator] Listener error:', e); }
            });
        }
        const allListeners = this.listeners.get('*');
        if (allListeners) {
            allListeners.forEach(l => {
                try { l(event); } catch (e) { console.error('[PublicSyncOrchestrator] Listener error:', e); }
            });
        }
    }
}
