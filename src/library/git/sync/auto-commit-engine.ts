/**
 * @file auto-commit-engine.ts
 * @description Component 1: Local Auto-Commit Engine (The State Tracker)
 *
 * Listens to Obsidian editor changes and auto-commits modified files with a
 * per-file 5-second sliding window debounce. Uses targeted `git add <file>`
 * to avoid locking the entire vault.
 *
 * Edge cases handled:
 * - Per-file debounce timers (rapid file switching)
 * - App-close flush (plugin.onunload drains all pending)
 * - Empty commits (nothing to commit → skip silently)
 * - Memory leak prevention (map keys deleted after commit)
 * - Large file guard (50MB+ files skipped with warning)
 * - POSIX path normalization (Windows backslash → forward slash)
 */

import { App, EventRef } from 'obsidian';
import { ISyncEngine, SyncEvent, SyncEventListener, SyncAuthor, AUTO_COMMIT_DEBOUNCE_MS } from './types';
import { GitCommandRunner } from './git-command-runner';
import { Mutex } from './mutex';
import { toPosixPath } from './path-utils';
import * as path from 'path';

export class AutoCommitEngine implements ISyncEngine {
    /**
     * Per-file debounce timers.
     * Key: POSIX-normalized vault-relative filepath
     * Value: setTimeout handle
     *
     * Entries are ALWAYS deleted after the timeout fires (success or failure)
     * to prevent memory leaks when editing many files in a session.
     */
    private debounceMap: Map<string, NodeJS.Timeout> = new Map();

    /**
     * Set of filepaths currently pending commit (timer fired, waiting for mutex).
     * Used by flush() to know what to batch-commit on app close.
     */
    private pendingFiles: Set<string> = new Set();

    private editorChangeRef: EventRef | null = null;
    private running = false;
    private listeners: Map<string, Set<SyncEventListener>> = new Map();

    /** External flag — set by MergeResolver to mute commits during merges. */
    public isMerging = false;

    constructor(
        private app: App,
        private absoluteDir: string,
        private runner: GitCommandRunner,
        private mutex: Mutex,
        private getAuthor: () => SyncAuthor,
        private isPaused: () => boolean,
    ) {}

    // ─── ISyncEngine ────────────────────────────────────────────

    start(): void {
        if (this.running) return;
        this.running = true;

        // Bind to Obsidian's editor-change event
        this.editorChangeRef = this.app.workspace.on('editor-change', (editor, info) => {
            if (this.isMerging || this.isPaused()) return; // Muted during merge or conflict resolution

            // info.file is the TFile being edited
            const file = (info as any)?.file;
            if (!file?.path) return;

            const posixPath = toPosixPath(file.path);
            this.scheduleCommit(posixPath);
        });
    }

    stop(): void {
        if (!this.running) return;
        this.running = false;

        // Unregister editor change listener
        if (this.editorChangeRef) {
            this.app.workspace.offref(this.editorChangeRef);
            this.editorChangeRef = null;
        }

        // Clear all pending debounce timers (but don't commit — stop means stop)
        for (const timer of this.debounceMap.values()) {
            clearTimeout(timer);
        }
        this.debounceMap.clear();
        this.pendingFiles.clear();
    }

    /**
     * Flush: drain all pending debounce timers and commit everything NOW.
     * Called from plugin.onunload() to ensure no work is lost on app close.
     */
    async flush(): Promise<void> {
        if (this.debounceMap.size === 0 && this.pendingFiles.size === 0) return;

        // 1. Clear all timers and collect their filepaths
        const filesToCommit = new Set<string>(this.pendingFiles);
        for (const [filepath, timer] of this.debounceMap.entries()) {
            clearTimeout(timer);
            filesToCommit.add(filepath);
        }
        this.debounceMap.clear();
        this.pendingFiles.clear();

        if (filesToCommit.size === 0) return;

        // 2. Batch commit all pending files
        const release = await this.mutex.acquire();
        try {
            for (const filepath of filesToCommit) {
                const absPath = path.join(this.absoluteDir, filepath);
                const safe = await this.runner.isFileSafeForAutoCommit(absPath);
                if (!safe) continue; // Skip large files even in flush

                try {
                    await this.runner.add(filepath);
                } catch {
                    // File may have been deleted between timer and now
                }
            }

            const author = this.getAuthor();
            const hash = Date.now().toString(36).slice(-6);
            const committed = await this.runner.commit(
                `auto: flush ${filesToCommit.size} files [${hash}]`,
                author
            );

            if (committed) {
                this.emit({ type: 'commit', detail: { files: Array.from(filesToCommit), flush: true } });
            }
        } catch (e: any) {
            console.error('[AutoCommitEngine] Flush failed:', e);
        } finally {
            release();
        }
    }

    // ─── Debounce Logic ─────────────────────────────────────────

    /**
     * Schedule an auto-commit for a file.
     * Uses a 5-second sliding window: every keystroke clears and resets the timer.
     */
    private scheduleCommit(filepath: string): void {
        // Clear existing timer for this file (sliding window)
        const existingTimer = this.debounceMap.get(filepath);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Track as pending (for flush)
        this.pendingFiles.add(filepath);

        // Set new timer
        const timer = setTimeout(() => {
            // ─── CRITICAL: Delete from map FIRST to prevent memory leak ───
            this.debounceMap.delete(filepath);
            this.pendingFiles.delete(filepath);

            // Fire the commit (async, not awaited from setTimeout)
            void this.commitFile(filepath);
        }, AUTO_COMMIT_DEBOUNCE_MS);

        this.debounceMap.set(filepath, timer);
    }

    /**
     * Commit a single file. Acquires mutex, runs git add + commit.
     */
    private async commitFile(filepath: string): Promise<void> {
        if (!this.running || this.isMerging) return;

        // Large file guard: check file size before committing
        const absPath = path.join(this.absoluteDir, filepath);
        const safe = await this.runner.isFileSafeForAutoCommit(absPath);
        if (!safe) {
            this.emit({
                type: 'large-file',
                detail: { filepath, absolutePath: absPath }
            });
            return;
        }

        const release = await this.mutex.acquire();
        try {
            // Stage the single file
            await this.runner.add(filepath);

            // Commit with auto-generated message
            const author = this.getAuthor();
            const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
            const hash = Date.now().toString(36).slice(-6);

            const committed = await this.runner.commit(
                `auto: ${timestamp} [${hash}]`,
                author
            );

            if (committed) {
                this.emit({ type: 'commit', detail: { filepath } });
            }
        } catch (e: any) {
            // Log but don't crash — auto-commit is best-effort
            if (e.kind !== 'nothing-to-commit') {
                console.error(`[AutoCommitEngine] Failed to auto-commit ${filepath}:`, e);
                this.emit({ type: 'error', detail: { filepath, error: e } });
            }
        } finally {
            release();
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
                try { l(event); } catch (e) { console.error('[AutoCommitEngine] Listener error:', e); }
            });
        }
        // Also emit to wildcard listeners
        const allListeners = this.listeners.get('*');
        if (allListeners) {
            allListeners.forEach(l => {
                try { l(event); } catch (e) { console.error('[AutoCommitEngine] Listener error:', e); }
            });
        }
    }
}
