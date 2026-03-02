/**
 * @file merge-resolver.ts
 * @description Component 4: Resolution & Ghost Merge (The Bridge)
 *
 * Handles the actual merge execution, file watcher muting, cursor preservation,
 * crash recovery, and auto-resolution of binary/config conflicts.
 *
 * Key invariants:
 * - Mutes file watcher via `isMerging` flag during merge
 * - Uses `app.vault.modify()` to align Obsidian cache + disk simultaneously
 * - Captures/restores editor cursor position to prevent UX disruption
 * - Checks for `.git/MERGE_HEAD` on boot for crash recovery
 * - Auto-resolves .obsidian/ config files (keep local)
 * - Auto-resolves binary files (keep local)
 * - Delegates manual text conflicts to existing MergeModal UI
 */

import { App, TFile } from 'obsidian';
import { ConflictDetectionResult, ConflictFile, SyncAuthor } from './types';
import { GitCommandRunner } from './git-command-runner';
import { toPosixPath } from './path-utils';

/** Callback to open the merge UI for manual text conflicts. */
export type OpenMergeUIFn = (absoluteDir: string, conflicts: string[], onResolved: (success: boolean) => Promise<void>) => void;

export class MergeResolver {
    /** Flag checked by AutoCommitEngine to mute during merge. */
    public isMerging = false;

    constructor(
        private app: App,
        private absoluteDir: string,
        private runner: GitCommandRunner,
        private getAuthor: () => SyncAuthor,
        private openMergeUI: OpenMergeUIFn,
    ) {}

    // ─── Crash Recovery ─────────────────────────────────────────

    /**
     * Check for and recover from a crashed merge on boot.
     * If `.git/MERGE_HEAD` exists, the previous merge was interrupted.
     * We abort it to return the vault to a safe state.
     */
    async recoverCrashedMerge(): Promise<boolean> {
        const hasMerge = await this.runner.hasMergeHead();
        if (hasMerge) {
            console.warn('[MergeResolver] Detected interrupted merge (MERGE_HEAD exists). Aborting to recover safe state.');
            try {
                await this.runner.mergeAbort();
                console.log('[MergeResolver] Crashed merge aborted successfully.');
                return true;
            } catch (e) {
                console.error('[MergeResolver] Failed to abort crashed merge:', e);
            }
        }
        return false;
    }

    // ─── Main Resolution Flow ───────────────────────────────────

    /**
     * Resolve conflicts detected by ConflictDetector.
     * Flow:
     * 1. Auto-resolve binary files (keep local)
     * 2. Auto-resolve .obsidian/ config files (keep local)
     * 3. Delegate remaining text conflicts to the 3-pane merge UI
     */
    async resolve(result: ConflictDetectionResult): Promise<void> {
        this.isMerging = true;

        try {
            // 1. Execute the actual merge (will create conflict markers in files)
            try {
                await this.runner.merge(await this.runner.currentBranch());
            } catch (e: any) {
                // Merge with conflicts is expected to "fail" — that's fine
                // We only care if it's a truly unexpected error
                const msg = e.message || e.raw?.message || '';
                if (!msg.includes('CONFLICT') && !msg.includes('Automatic merge failed')) {
                    throw e;
                }
            }

            // 2. Separate conflicts by type
            const binaryConflicts: ConflictFile[] = [];
            const configConflicts: ConflictFile[] = [];
            const deleteConflicts: ConflictFile[] = [];
            const textConflicts: ConflictFile[] = [];

            for (const file of result.files) {
                if (file.type === 'binary') {
                    binaryConflicts.push(file);
                } else if (file.type === 'delete-modify' || file.type === 'rename-modify') {
                    deleteConflicts.push(file);
                } else if (this.isConfigFile(file.path)) {
                    configConflicts.push(file);
                } else {
                    textConflicts.push(file);
                }
            }

            // 3. Auto-resolve binary files: keep local version
            for (const file of binaryConflicts) {
                await this.resolveKeepLocal(file.path);
            }

            // 4. Auto-resolve config files: keep local version
            for (const file of configConflicts) {
                await this.resolveKeepLocal(file.path);
            }

            // 5. Auto-resolve delete conflicts: keep the existing version
            for (const file of deleteConflicts) {
                await this.resolveKeepLocal(file.path);
            }

            // 6. Delegate text conflicts to the merge UI
            if (textConflicts.length > 0) {
                const conflictPaths = textConflicts.map(f => f.path);
                await new Promise<void>((resolve) => {
                    this.openMergeUI(this.absoluteDir, conflictPaths, async (success) => {
                        if (success) {
                            // After user resolves in the 3-pane UI, finalize
                            await this.finalizeResolvedFiles(conflictPaths);
                        }
                        resolve();
                    });
                });
            }

            // 7. Finalize the merge
            await this.finalizeMerge();

        } finally {
            this.isMerging = false;
        }
    }

    // ─── Resolution Strategies ──────────────────────────────────

    /**
     * Resolve a conflict by keeping the local (ours) version.
     * Used for binary files and .obsidian/ config files.
     */
    private async resolveKeepLocal(filepath: string): Promise<void> {
        try {
            // Checkout our version
            await this.runner.exec(['checkout', '--ours', toPosixPath(filepath)]);
            await this.runner.add(toPosixPath(filepath));
            console.log(`[MergeResolver] Auto-resolved (keep local): ${filepath}`);
        } catch (e) {
            console.error(`[MergeResolver] Failed to auto-resolve ${filepath}:`, e);
        }
    }

    /**
     * After the user has manually resolved files via the merge UI,
     * write them to Obsidian's vault and stage them.
     */
    private async finalizeResolvedFiles(filepaths: string[]): Promise<void> {
        for (const filepath of filepaths) {
            const posixPath = toPosixPath(filepath);

            // Capture cursor/scroll state if this file is currently open
            const cursorState = this.captureEditorState(filepath);

            // Read the resolved content from disk (merge UI already wrote it)
            // and force Obsidian's cache to align via vault.modify()
            const tfile = this.app.vault.getAbstractFileByPath(filepath);
            if (tfile instanceof TFile) {
                try {
                    const content = await this.app.vault.read(tfile);
                    await this.app.vault.modify(tfile, content);

                    // Restore cursor/scroll state
                    if (cursorState) {
                        this.restoreEditorState(filepath, cursorState);
                    }
                } catch (e) {
                    console.warn(`[MergeResolver] Could not force-refresh Obsidian cache for ${filepath}:`, e);
                }
            }

            // Stage the resolved file
            await this.runner.add(posixPath);
        }
    }

    // ─── Cursor Preservation ────────────────────────────────────

    private captureEditorState(filepath: string): { line: number; ch: number; scrollTop: number } | null {
        const leaves = this.app.workspace.getLeavesOfType('markdown');
        for (const leaf of leaves) {
            const view = leaf.view as any;
            if (view?.file?.path === filepath && view.editor) {
                const editor = view.editor;
                const cursor = editor.getCursor();
                const scrollInfo = editor.getScrollInfo?.();
                return {
                    line: cursor.line,
                    ch: cursor.ch,
                    scrollTop: scrollInfo?.top ?? 0,
                };
            }
        }
        return null;
    }

    private restoreEditorState(filepath: string, state: { line: number; ch: number; scrollTop: number }): void {
        // Defer to next tick to let Obsidian process the file change
        setTimeout(() => {
            const leaves = this.app.workspace.getLeavesOfType('markdown');
            for (const leaf of leaves) {
                const view = leaf.view as any;
                if (view?.file?.path === filepath && view.editor) {
                    view.editor.setCursor({ line: state.line, ch: state.ch });
                    view.editor.scrollTo?.(0, state.scrollTop);
                    break;
                }
            }
        }, 50);
    }

    // ─── Finalization ───────────────────────────────────────────

    /**
     * Finalize the merge: commit with --no-edit and unset isMerging.
     */
    private async finalizeMerge(): Promise<void> {
        try {
            const author = this.getAuthor();
            await this.runner.exec(['commit', '--no-edit'], this.runner.authorEnv(author));
            console.log('[MergeResolver] Merge finalized and committed.');
        } catch (e: any) {
            // If there's nothing to commit (all conflicts were auto-resolved with no change), that's OK
            if (e.kind === 'nothing-to-commit') {
                console.debug('[MergeResolver] Merge finalized (nothing additional to commit)');
                return;
            }
            console.error('[MergeResolver] Failed to finalize merge commit:', e);
            throw e;
        }
    }

    // ─── Helpers ────────────────────────────────────────────────

    private isConfigFile(filepath: string): boolean {
        const configPatterns = ['.obsidian/', 'workspace.json', 'appearance.json',
            'hotkeys.json', 'core-plugins.json', 'plugins.json'];
        return configPatterns.some(p => filepath.includes(p));
    }
}
