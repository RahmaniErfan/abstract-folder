/**
 * @file shallow-sync-executor.ts
 * @description Engine 2, Component 3: Shallow Fetch & Hard Reset (The Execution).
 *
 * Executes the actual git operations for unidirectional public library sync.
 *
 * Key behaviors:
 * - Dirty tree recovery: uses `app.vault.adapter.copy()` (NOT Node fs) to salvage
 *   user modifications before hard reset — prevents Obsidian file cache desync
 * - Shallow fetch: `git fetch --depth 1 origin <branch>`
 * - Hard reset: `git reset --hard origin/<branch>`
 * - Sparse checkout: if subscribedTopics is configured, only those topics are checked out
 * - GC: `git gc --prune=now` on configurable interval (default 14 days)
 * - UI refresh: reloads open markdown tabs affected by the reset
 *
 * Desktop-only: relies on GitCommandRunner (child_process).
 */

import { App } from 'obsidian';
import { GitCommandRunner } from './git-command-runner';
import { SyncEvent, SyncEventListener, SyncEventType, ENGINE2_GC_INTERVAL_MS } from './types';
import { Mutex } from './mutex';
import { sanitizeTopicName } from '../../../utils/sanitization';

// ─── Types ──────────────────────────────────────────────────────────

export interface ShallowSyncResult {
    updated: boolean;
    recoveredFiles: string[];
}

export interface ShallowSyncExecutorConfig {
    app: App;
    absoluteDir: string;
    vaultPath: string;
    runner: GitCommandRunner;
    mutex: Mutex;
    branch: string;
    repositoryUrl: string; // Ensure URL is available for initial init
    libraryName: string;   // For Group registration
    subscribedTopics?: string[];
    lastGcTime?: number;
    onGcRun?: (timestamp: number) => void;
}

// ─── Shallow Sync Executor ──────────────────────────────────────────

export class ShallowSyncExecutor {
    private listeners: Map<string, Set<SyncEventListener>> = new Map();
    private sparseCheckoutInitialized = false;

    constructor(private config: ShallowSyncExecutorConfig) {}

    /**
     * Execute the full shallow sync cycle:
     * 1. Check for dirty working tree
     * 2. Recover modified files (if any)
     * 3. Sparse checkout (if configured)
     * 4. Shallow fetch
     * 5. Hard reset
     * 6. Refresh UI
     */
    async execute(): Promise<ShallowSyncResult> {
        const { runner, mutex, branch, app, vaultPath } = this.config;
        const release = await mutex.acquire();

        try {
            // 1. Ensure Git repo is initialized (Engine 2 Handshake)
            await this.ensureGitRepo();

            // 2. Detect dirty working tree
            const dirtyFiles = await runner.statusPorcelain();
            let recoveredFiles: string[] = [];

            // 3. Recover user modifications before destructive reset
            if (dirtyFiles.length > 0) {
                recoveredFiles = await this.recoverDirtyFiles(dirtyFiles);
                this.emit({
                    type: 'dirty-recovered',
                    detail: { files: recoveredFiles },
                });
            }

            let effectiveBranch = branch || 'main';
            try {
                // Determine true default branch if remote has a different one
                const remoteBranch = await runner.getRemoteDefaultBranch();
                if (remoteBranch && (!branch || branch === 'main' || branch === 'master')) {
                    effectiveBranch = remoteBranch;
                }
            } catch (e) {
                // Fallback
            }

            // 4. Shallow fetch — only the tip of the tree
            await runner.fetchShallow(effectiveBranch);

            // 5. Sparse checkout (if configured)
            // Now that we've fetched, we can use ls-tree to resolve correctly cased topics
            if (this.config.subscribedTopics?.length) {
                await this.ensureSparseCheckout(effectiveBranch);
            }

            // 6. Hard reset — force local to match remote exactly
            await runner.resetHard(effectiveBranch);

            // 7. V2 Architecture Pivot: Local state is now managed strictly in plugin settings,
            // never by patching the repository's library.json. This prevents git noise.
            
            // 8. Refresh Obsidian's file cache and reload open tabs
            await this.refreshUI();

            this.emit({
                type: 'update-applied',
                detail: { recoveredFiles: recoveredFiles.length },
            });

            return { updated: true, recoveredFiles };

        } catch (error: any) {
            console.error('[ShallowSyncExecutor] Sync failed:', error);
            this.emit({
                type: 'error',
                detail: { phase: 'shallow-sync', error: error.message || error },
            });
            return { updated: false, recoveredFiles: [] };
        } finally {
            release();
        }
    }

    /**
     * Engine 2 Handshake: Ensure the repository is initialized and origin is set.
     */
    private async ensureGitRepo(): Promise<void> {
        const { runner, absoluteDir } = this.config;
        const gitDir = `${absoluteDir}/.git`;
        
        try {
            const { stat } = require('fs/promises');
            await stat(gitDir);
        } catch {
            console.log(`[ShallowSyncExecutor] initializing new git repo at ${absoluteDir}`);
            await runner.init();
            
            // We need the repository URL for the initial remote add
            const repoUrl = this.config.repositoryUrl;
            if (!repoUrl) {
                throw new Error("Cannot initialize Git repo: missing repositoryUrl");
            }
            await runner.remoteAdd(repoUrl);
        }

        // Ensure _recovered/ is ignored locally to keep git status clean
        await this.ensureRecoveredIgnored();
    }

    /**
     * Add _recovered/ to .git/info/exclude if not already present.
     * This keeps the directory out of user's 'git status' without modifying the shared .gitignore.
     */
    private async ensureRecoveredIgnored(): Promise<void> {
        const { absoluteDir } = this.config;
        const excludePath = `${absoluteDir}/.git/info/exclude`;
        const { readFile, writeFile, mkdir } = require('fs/promises');

        try {
            // Ensure dir exists (init might have failed or reached a weird state)
            await mkdir(`${absoluteDir}/.git/info`, { recursive: true });

            let content = '';
            try {
                content = await readFile(excludePath, 'utf8');
            } catch (e) {
                // File might not exist yet
            }

            if (!content.includes('_recovered/')) {
                const newContent = content.endsWith('\n') || content === '' 
                    ? `${content}_recovered/\n` 
                    : `${content}\n_recovered/\n`;
                await writeFile(excludePath, newContent, 'utf8');
                console.debug(`[ShallowSyncExecutor] Added _recovered/ to ${excludePath}`);
            }
        } catch (error) {
            console.warn('[ShallowSyncExecutor] Failed to update git excludes:', error);
        }
    }

    /**
     * Ghost Topic Detection: Warns user if a subscribed topic yielded 0 files.
     */
    private async validateSubscriptionResults(): Promise<void> {
        const { app, vaultPath, subscribedTopics } = this.config;
        if (!subscribedTopics || subscribedTopics.length === 0) return;

        // Get actual folders on disk to check against
        const diskFolders = await app.vault.adapter.list(vaultPath || "/");
        const diskFolderNames = diskFolders.folders.map(f => {
            const parts = f.split("/");
            return parts[parts.length - 1];
        });

        const missingTopics: string[] = [];
        for (const topic of subscribedTopics) {
            const match = diskFolderNames.find(d => d.toLowerCase() === topic.toLowerCase());
            if (!match) {
                missingTopics.push(topic);
            }
        }

        if (missingTopics.length > 0) {
            const { Notice } = require("obsidian");
            new Notice(`Warning: Some subscribed topics were not found in the remote repository: ${missingTopics.join(", ")}`, 10000);
            console.warn(`[ShallowSyncExecutor] Ghost Topics detected: ${missingTopics.join(", ")}`);
        }
    }


    /**
     * Fire-and-forget GC for shallow repos.
     * Runs `git gc --prune=now` to clean orphaned blobs from repeated --depth 1 fetches.
     */
    gcIfNeeded(): void {
        const lastGc = this.config.lastGcTime || 0;
        const now = Date.now();

        if (now - lastGc < ENGINE2_GC_INTERVAL_MS) {
            return; // Not due yet
        }

        console.log(`[ShallowSyncExecutor] Running git gc --prune=now (last run: ${new Date(lastGc).toISOString()})`);
        this.config.runner.gcPrune();

        if (this.config.onGcRun) {
            this.config.onGcRun(now);
        }
    }

    // ─── Dirty Tree Recovery ────────────────────────────────────

    /**
     * Salvage user-modified files to a `_recovered/<timestamp>/` folder
     * BEFORE executing the destructive hard reset.
     *
     * CRITICAL: Uses `app.vault.adapter.copy()` instead of Node `fs.copyFile()`.
     * Using native fs causes Obsidian's internal file cache to desync violently.
     */
    private async recoverDirtyFiles(dirtyFiles: string[]): Promise<string[]> {
        const { app, vaultPath } = this.config;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const recoveryDir = `_recovered/${timestamp}`;
        const recoveredPaths: string[] = [];

        console.log(`[ShallowSyncExecutor] Recovering ${dirtyFiles.length} dirty files to ${recoveryDir}`);

        for (const relativePath of dirtyFiles) {
            try {
                // Skip library.json in recovery — it's intentionally patched by the plugin
                // and should not trigger a recovery folder on every sync.
                if (relativePath === 'library.json') {
                    console.debug(`[ShallowSyncExecutor] Skipping library.json in recovery (plugin-managed)`);
                    continue;
                }

                const sourcePath = vaultPath ? `${vaultPath}/${relativePath}` : relativePath;

                // Check if source file actually exists in vault
                const exists = await app.vault.adapter.exists(sourcePath);
                if (!exists) continue;

                const destPath = vaultPath
                    ? `${vaultPath}/${recoveryDir}/${relativePath}`
                    : `${recoveryDir}/${relativePath}`;

                // Ensure destination directory exists
                const destDir = destPath.substring(0, destPath.lastIndexOf('/'));
                await app.vault.adapter.mkdir(destDir);

                // Use Obsidian's adapter to copy — keeps file cache in sync
                await app.vault.adapter.copy(sourcePath, destPath);
                recoveredPaths.push(destPath);

                console.debug(`[ShallowSyncExecutor] Recovered: ${sourcePath} → ${destPath}`);
            } catch (e) {
                console.warn(`[ShallowSyncExecutor] Failed to recover ${relativePath}:`, e);
                // Non-fatal: continue recovering other files
            }
        }

        return recoveredPaths;
    }

    // ─── Sparse Checkout ────────────────────────────────────────

    /**
     * Initialize sparse checkout (once) and set subscribed folders.
     */
    private async ensureSparseCheckout(effectiveBranch: string): Promise<void> {
        const { runner, subscribedTopics } = this.config;
        if (!subscribedTopics?.length) return;

        try {
            if (!this.sparseCheckoutInitialized) {
                await runner.sparseCheckoutInit();
                this.sparseCheckoutInitialized = true;
                console.log('[ShallowSyncExecutor] Sparse checkout initialized');
            }

            // Case Sensitivity Fix: Resolve correctly cased topic folders from remote
            const actualRemoteFolders = await runner.lsTreeRemote(effectiveBranch);
            const correctlyCasedSubscribedTopics = this.resolveCorrectlyCasedTopics(subscribedTopics, actualRemoteFolders);

            await runner.sparseCheckoutSet(correctlyCasedSubscribedTopics);
            console.log(`[ShallowSyncExecutor] Sparse checkout set to (normalized): ${correctlyCasedSubscribedTopics.join(', ')}`);
        } catch (e) {
            console.error('[ShallowSyncExecutor] Sparse checkout failed:', e);
            // Non-fatal: fall back to full checkout
        }
    }

    /**
     * Normalizes subscribed topics to match the actual casing found in the repository.
     * Essential for Linux where Git is case-sensitive, but manifests might have slight casing mismatches.
     */
    private resolveCorrectlyCasedTopics(subscribed: string[], actualFolders: string[]): string[] {
        const normalized: string[] = [];
        
        for (const requested of subscribed) {
            const match = actualFolders.find(actual => actual.toLowerCase() === requested.toLowerCase());
            if (match) {
                normalized.push(match);
            } else {
                // If no case-insensitive match found, keep requested name (Git will handle it)
                normalized.push(requested);
            }
        }
        
        return normalized;
    }


    // ─── UI Refresh ─────────────────────────────────────────────

    /**
     * Refresh Obsidian's file cache and force-reload open markdown tabs
     * that may have been altered by the hard reset.
     */
    private async refreshUI(): Promise<void> {
        const { app, vaultPath } = this.config;

        // 1. Refresh vault file listing
        try {
            await app.vault.adapter.list(vaultPath || '/');
        } catch (e) {
            console.warn('[ShallowSyncExecutor] Vault listing refresh failed:', e);
        }

        // 2. Reload open markdown tabs affected by the reset
        try {
            const leaves = app.workspace.getLeavesOfType('markdown');
            for (const leaf of leaves) {
                const viewState = leaf.getViewState();
                const filePath = viewState?.state?.file;
                if (filePath && typeof filePath === 'string') {
                    // Only reload tabs within this library's path
                    const isInLibrary = vaultPath
                        ? filePath.startsWith(vaultPath)
                        : true;

                    if (isInLibrary) {
                        // Force re-read from disk
                        await leaf.setViewState(viewState);
                    }
                }
            }
        } catch (e) {
            console.warn('[ShallowSyncExecutor] Tab refresh failed:', e);
        }

        // 3. Trigger bridge cache invalidation
        (app.workspace as any).trigger('abstract-folder:spaces-updated');
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
                try { l(event); } catch (e) { console.error('[ShallowSyncExecutor] Listener error:', e); }
            });
        }
        const allListeners = this.listeners.get('*');
        if (allListeners) {
            allListeners.forEach(l => {
                try { l(event); } catch (e) { console.error('[ShallowSyncExecutor] Listener error:', e); }
            });
        }
    }
}
