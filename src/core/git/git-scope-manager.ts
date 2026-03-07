import { App, TAbstractFile, debounce } from "obsidian";
import * as git from "isomorphic-git";
import { NodeFsAdapter } from "./node-fs-adapter";

export interface GitScopeState {
    id: string;
    path: string; // Absolute path
    isRepo: boolean;
    localChanges: number;
    remoteChanges: number;
    ahead: number;
    lastChecked: number;
}

export type ScopeStatusListener = (state: GitScopeState) => void;

export class GitScopeManager {
    private scopes: Map<string, GitScopeState> = new Map();
    private listeners: Map<string, Set<ScopeStatusListener>> = new Map();
    private processing: Map<string, Promise<void>> = new Map();
    private pollInterval: NodeJS.Timeout | null = null;
    private isPolling = false;

    constructor(
        private app: App,
        private getPollIntervalMs: () => number = () => 10000
    ) {
        this.startPolling();
        this.setupEventListeners();
    }

    private setupEventListeners() {
        // Debounce the refresh to avoid excessive git checks
        const requestRefresh = debounce((path: string) => {
            this.handleFileChange(path);
        }, 500, true);

        this.app.vault.on("create", (file) => requestRefresh(file.path));
        this.app.vault.on("delete", (file) => requestRefresh(file.path));
        this.app.vault.on("modify", (file) => requestRefresh(file.path));
        this.app.vault.on("rename", (file, oldPath) => {
             requestRefresh(file.path);
             requestRefresh(oldPath);
        });
    }

    private handleFileChange(vaultPath: string) {
        // Convert vault path to absolute path to find matching scope
        // Note: The vaultPath from event is relative to vault root.
        // We need to check which registered scope contains this path.
        
        // This is tricky because we track scopes by absolute path usually, 
        // but 'id' is often the relative path.
        
        // Let's iterate scopes and check if the file is inside.
        // We use the adapter to get absolute path of the changed file.
        let absPath = "";
        try {
             absPath = (this.app.vault.adapter as any).getFullPath(vaultPath);
        } catch(e) { return; }

        for (const scope of this.scopes.values()) {
            // Check if file is inside scope path
            // e.g. Scope: /Users/me/Vault/Spaces/A
            // File: /Users/me/Vault/Spaces/A/note.md
            if (absPath.startsWith(scope.path)) {
                void this.refreshScope(scope.id);
            }
        }
    }

    public registerScope(id: string, absolutePath: string) {
        // If scope exists but path changed, update it.
        const existing = this.scopes.get(id);
        if (existing && existing.path !== absolutePath) {
            this.scopes.set(id, { ...existing, path: absolutePath });
            void this.refreshScope(id);
            return;
        }

        if (!existing) {
            this.scopes.set(id, {
                id,
                path: absolutePath,
                isRepo: false,
                localChanges: 0,
                remoteChanges: 0,
                ahead: 0,
                lastChecked: 0
            });
            void this.refreshScope(id);
        }
    }

    public unregisterScope(id: string) {
        this.scopes.delete(id);
        this.listeners.delete(id);
    }

    public getScope(id: string): GitScopeState | undefined {
        return this.scopes.get(id);
    }

    public subscribe(id: string, listener: ScopeStatusListener): () => void {
        if (!this.listeners.has(id)) {
            this.listeners.set(id, new Set());
        }
        this.listeners.get(id)!.add(listener);

        // Emit current state immediately if valid
        const state = this.scopes.get(id);
        if (state) {
            listener(state);
        }

        return () => {
            const set = this.listeners.get(id);
            if (set) {
                set.delete(listener);
            }
        };
    }

    public async refreshScope(id: string) {
        const scope = this.scopes.get(id);
        if (!scope) return;

        // Concurrency Control: Chain refresh requests to prevent overlaps
        const currentTask = this.processing.get(id) || Promise.resolve();
        
        const nextTask = currentTask.then(async () => {
             await this.performRefresh(id);
        }).catch(e => console.error(e));
        
        this.processing.set(id, nextTask);
        return nextTask;
    }

    private async performRefresh(id: string) {
        const scope = this.scopes.get(id);
        if (!scope) return;
        
        try {
            // Check if directory exists first
            const exists = await NodeFsAdapter.promises.stat(scope.path).catch(() => null);
            if (!exists) return;

            // 1. Check if it's a Repo
            let isRepo = false;
            try {
                const gitRoot = await git.findRoot({ fs: NodeFsAdapter, filepath: scope.path });
                isRepo = !!gitRoot;
            } catch (e) {
                isRepo = false;
            }

            // 2. Local Status (Changes)
            let dirtyCount = 0;
            if (isRepo) {
                try {
                    const matrix = await git.statusMatrix({ 
                        fs: NodeFsAdapter, 
                        dir: scope.path 
                    });
                    
                    // Filter logic: 
                    // head: 0 (absent), 1 (exists)
                    // workdir: 0 (absent), 1 (unmodified), 2 (modified/new)
                    // stage: 0 (absent), 1 (unmodified), 2 (modified/staged), 3 (conflict)
                    
                    dirtyCount = matrix.filter((row: any[]) => {
                        const [filepath, head, workdir, stage] = row;
                        
                        // Ignore files that isomorphic-git considers "ignored" (0,0,0) 
                        // or that are not modified relative to HEAD and Index.
                        if (head === 0 && workdir === 0 && stage === 0) return false;
                        
                        // Match what `git status` shows as modified, added, or deleted
                        return head !== workdir || workdir !== stage;
                    }).length;
                } catch (e) {}
            }

            // 3. Commit Counts (Ahead/Behind)
            let ahead = 0;
            let behind = 0;
            
            if (isRepo) {
                try {
                    const currentBranch = await git.currentBranch({ fs: NodeFsAdapter, dir: scope.path });
                    if (currentBranch) {
                        const trackingBranch = `origin/${currentBranch}`;
                        const remoteRef = await git.resolveRef({ fs: NodeFsAdapter, dir: scope.path, ref: trackingBranch }).catch(() => null);
                        
                        if (remoteRef) {
                            const commits = await git.log({
                                 fs: NodeFsAdapter,
                                 dir: scope.path,
                                 ref: currentBranch as string,
                                 depth: 100 
                            });
                            
                             const remoteOid = remoteRef;
                             let foundRemote = false;
                             let extraCommits = 0;
                             for (const c of commits) {
                                 if (c.oid === remoteOid) {
                                     foundRemote = true;
                                     break;
                                 }
                                 extraCommits++;
                             }
                             if (foundRemote) {
                                 ahead = extraCommits;
                             }
                        }
                    }
                } catch (e) {}
            }

            const newState: GitScopeState = {
                ...scope,
                isRepo,
                localChanges: dirtyCount,
                ahead,
                remoteChanges: behind,
                lastChecked: Date.now()
            };

            // Only notify if changed (simple equality check)
            if (this.hasChanged(scope, newState)) {
                this.scopes.set(id, newState);
                this.notifyListeners(id, newState);
            } else {
                 // Update internal state to prevent repeated checks but don't notify
                 this.scopes.set(id, newState);
            }

        } catch (e) {
            console.error(`[GitScopeManager] Fatal error refreshing scope ${id}`, e);
        }
    }

    private notifyListeners(id: string, state: GitScopeState) {
        const scopeListeners = this.listeners.get(id);
        if (scopeListeners) {
            scopeListeners.forEach(listener => {
                try {
                    listener(state);
                } catch (e) {
                    console.error(`[GitScopeManager] Listener failed for scope ${id}`, e);
                }
            });
        }
    }

    private hasChanged(a: GitScopeState, b: GitScopeState): boolean {
        return a.isRepo !== b.isRepo ||
               a.localChanges !== b.localChanges || 
               a.remoteChanges !== b.remoteChanges || 
               a.ahead !== b.ahead;
    }

    private startPolling() {
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.pollInterval = setInterval(() => {
            this.pollAll();
        }, this.getPollIntervalMs()); 
    }

    private async pollAll() {
        if (this.isPolling) return;
        this.isPolling = true;
        
        const promises = Array.from(this.scopes.keys()).map(id => this.refreshScope(id));
        await Promise.all(promises);
        
        this.isPolling = false;
    }
}
