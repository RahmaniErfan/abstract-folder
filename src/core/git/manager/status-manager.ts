import { App, Platform } from "obsidian";
import { GitService } from "./git-service";
import { GitStatusMatrix } from "../types";
import { Logger } from "../../../utils/logger";

/**
 * StatusManager handles Git status caching and matrix calculations.
 * It implements a SWR (Stale-While-Revalidate) pattern for performance.
 */
export class StatusManager {
    // Cache includes isFetching lock
    private cache: Map<string, { 
        dirty: boolean; 
        isFetching: boolean; 
        pendingRefresh: boolean; // Flag to queue a refresh if one is requested while fetching
        data: GitStatusMatrix 
    }> = new Map();
    // Idle-Detection Debouncer Map for Smart Background Sync
    private syncTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor(
        private app: App,
        private gitService: GitService,
        private getIdleTimeoutMs: () => number = () => 3000 // Injected Default
    ) {}

    public flagCacheDirty(filePath: string) {
        // Longest-Prefix Match: Implement by sorting keys by length descending
        // to ensure specific sub-repos (spaces/libraries) are prioritized over the vault root ("").
        const sortedRepos = Array.from(this.cache.keys()).sort((a, b) => b.length - a.length);

        for (const vaultPath of sortedRepos) {
            if (filePath.startsWith(vaultPath + '/') || filePath === vaultPath || (vaultPath === "" && filePath !== "")) {
                Logger.debug(`[StatusManager] Flagging cache dirty for repo: "${vaultPath}" due to file: ${filePath}`);
                this.flagCacheDirtyByPath(vaultPath);
                return;
            }
        }
    }

    public flagCacheDirtyByPath(vaultPath: string) {
        const currentCache = this.cache.get(vaultPath);
        if (currentCache) {
            currentCache.dirty = true;
            // If currently fetching, queue a refresh for when it finishes
            if (currentCache.isFetching) {
                currentCache.pendingRefresh = true;
                Logger.debug(`[StatusManager] Fetch already in progress for ${vaultPath || 'root'}. Queuing pending refresh.`);
            }
        }

        // Smart Background Coordinator: Idle-Detection Debouncer
        if (this.syncTimers.has(vaultPath)) {
            clearTimeout(this.syncTimers.get(vaultPath)!);
        }
        
        const timer = setTimeout(() => {
            this.syncTimers.delete(vaultPath);
            // Proactive sync
            void this.getFileStatuses(vaultPath);
        }, this.getIdleTimeoutMs()); 
        
        this.syncTimers.set(vaultPath, timer);
    }

    /**
     * Retrieves the instantly accessible cached Git status for any file path,
     * interrogating out all known sub-repositories (spaces/libraries).
     */
    public getCachedStatusForPath(filePath: string): 'synced' | 'modified' | 'conflict' | 'untracked' | null {
        const sortedRepos = Array.from(this.cache.keys()).sort((a, b) => b.length - a.length);
        for (const repoPath of sortedRepos) {
            if (repoPath === "" || filePath === repoPath || filePath.startsWith(repoPath + '/')) {
                const cache = this.cache.get(repoPath);
                if (!cache) continue;
                
                const relativePath = repoPath === "" ? filePath : (filePath === repoPath ? "" : filePath.substring(repoPath.length + 1));
                const status = cache.data.get(relativePath);
                if (status) return status;
            }
        }
        return null;
    }

    /**
     * Get the Git status for all files in a library.
     */
    async getFileStatuses(vaultPath: string): Promise<GitStatusMatrix> {
        let cached = this.cache.get(vaultPath);

        // 1. If we have a clean cache and NOT fetching, return data
        if (cached && !cached.dirty && !cached.isFetching) {
            return cached.data;
        }

        // 2. Dispatch background request if dirty and NOT currently fetching (SWR Concurrency Lock)
        if (!cached || (!cached.isFetching && cached.dirty)) {
            let isVisible = false;
            const leaves = this.app.workspace.getLeavesOfType("abstract-folder-view").concat(
                this.app.workspace.getLeavesOfType("abstract-spaces-explorer"),
                this.app.workspace.getLeavesOfType("abstract-library-explorer")
            );
            
            for (const leaf of leaves) {
                const view = leaf.view as any;
                if (view.contextEngine) {
                    const activePaths = view.contextEngine.getActiveRepositoryPaths();
                    if (activePaths.size === 0 || Array.from(activePaths).some((p: string) => p.startsWith(vaultPath) || vaultPath.startsWith(p))) {
                        isVisible = true;
                        break;
                    }
                }
            }

            if (!isVisible && cached) {
               return cached.data;
            }

            if (!cached) {
                cached = { dirty: true, isFetching: true, pendingRefresh: false, data: new Map() };
                this.cache.set(vaultPath, cached);
            } else {
                cached.isFetching = true;
                cached.pendingRefresh = false; // Reset since we are starting a fresh fetch now
            }

            const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
            
            // 3. Pre-flight check: Ensure directory exists to avoid ENOENT in Git runner (which triggers false-positive fallbacks)
            try {
                const { stat } = require('fs/promises');
                await stat(absoluteDir);
            } catch {
                cached.isFetching = false;
                cached.dirty = false;
                cached.pendingRefresh = false;
                return cached.data;
            }
            
            const ignoredPaths: string[] = [];
            for (const otherPath of this.cache.keys()) {
                if (otherPath === vaultPath) continue;
                
                if (vaultPath === "" || otherPath.startsWith(vaultPath + "/")) {
                    const ignored = vaultPath === "" ? otherPath : otherPath.substring(vaultPath.length + 1);
                    ignoredPaths.push(ignored);
                }
            }

            // Background Promise
            this.gitService.getStatusMatrix(absoluteDir, ignoredPaths)
                .then((matrix) => {
                    const freshMatrix: GitStatusMatrix = new Map();
                    for (const [path, status] of matrix.entries()) {
                        const normalizedPath = path.startsWith('./') ? path.substring(2) : path;
                        freshMatrix.set(normalizedPath, status);
                    }

                    const currentCache = this.cache.get(vaultPath);
                    if (currentCache) {
                        currentCache.dirty = false;
                        currentCache.isFetching = false;
                        currentCache.data = freshMatrix;
                        
                        // Check for queued refresh
                        if (currentCache.pendingRefresh) {
                            currentCache.pendingRefresh = false;
                            Logger.debug(`[StatusManager] Pending refresh found for ${vaultPath || 'root'}. Retriggering.`);
                            void this.getFileStatuses(vaultPath);
                        }
                    }
                    console.debug(`[StatusManager] Background git refresh complete for ${vaultPath} (${freshMatrix.size} files)`);
                    this.app.workspace.trigger('abstract-folder:git-refreshed', vaultPath);
                })
                .catch((error) => {
                    console.error(`[StatusManager] Failed to fetch git status for ${vaultPath}`, error);
                    const currentCache = this.cache.get(vaultPath);
                    if (currentCache) {
                        currentCache.isFetching = false;
                        currentCache.pendingRefresh = false;
                    }
                });
        }

        return cached!.data;
    }

    /**
     * Get counts of unstaged, uncommitted, and unpushed changes.
     */
    async getSyncStatus(vaultPath: string): Promise<{ ahead: number; dirty: number }> {
        try {
            const matrix = await this.getFileStatuses(vaultPath);
            
            let dirty = 0;
            for (const status of matrix.values()) {
                if (status !== 'synced') dirty++;
            }
            
            return { ahead: 0, dirty }; 
        } catch (e) {
            return { ahead: 0, dirty: 0 };
        }
    }

    public clearFetchingLock(vaultPath: string) {
        const cached = this.cache.get(vaultPath);
        if (cached) {
            cached.isFetching = false;
        }
    }

    /**
     * Explicitly clear the cache for a specific vault path.
     * Useful when a library is uninstalled.
     */
    public clearCache(vaultPath: string) {
        if (this.syncTimers.has(vaultPath)) {
            clearTimeout(this.syncTimers.get(vaultPath)!);
            this.syncTimers.delete(vaultPath);
        }
        this.cache.delete(vaultPath);
        Logger.debug(`[StatusManager] Cache cleared for: "${vaultPath}"`);
    }

    public cleanup() {
        for (const timer of this.syncTimers.values()) {
            clearTimeout(timer);
        }
        this.syncTimers.clear();
    }

    // Helper to get cache keys for other services if needed
    public getCacheKeys(): string[] {
        return Array.from(this.cache.keys());
    }

    public hasCache(vaultPath: string): boolean {
        return this.cache.has(vaultPath);
    }
}
