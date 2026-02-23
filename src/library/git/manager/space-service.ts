import { App, Notice } from "obsidian";
import * as path from 'path';
import * as git from "isomorphic-git";
import { GitService } from "./git-service";
import { StatusManager } from "./status-manager";
import { SecurityManager } from "../../../core/security-manager";
import { AbstractFolderPluginSettings } from "../../../settings";
import { NodeFsAdapter } from "../node-fs-adapter";
import { ConflictManager } from "../conflict-manager";
import { MergeModal } from "../../../ui/modals/merge/merge-modal";
import { ConflictResolutionModal } from "../../../ui/modals/conflict-resolution-modal";
import { Logger } from "../../../utils/logger";
import { AuthService } from "../../services/auth-service";
import { GitScopeManager } from "../git-scope-manager";
import { IGitEngine } from "../types";

/**
 * SpaceService handles operations for shared spaces and personal backups.
 * These repositories typically don't follow the library.json structure.
 */
export class SpaceService {
    private isConflictModalOpen = false;

    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private gitService: GitService,
        private statusManager: StatusManager,
        private securityManager: SecurityManager,
        private scopeManager: GitScopeManager,
        private stopSyncEngineCallback: (vaultPath: string) => void
    ) {}

    /**
     * Clone a shared space (collaborative folder).
     */
    async cloneSpace(repositoryUrl: string, destinationPath: string, token?: string): Promise<void> {
        try {
            const absoluteDir = this.gitService.getAbsolutePath(destinationPath);

            // Ensure the directory exists before cloning into it with '.'
            await NodeFsAdapter.promises.mkdir(absoluteDir, { recursive: true });

            const engine = await this.gitService.getEngine();
            const tokenToUse = token || await this.gitService.ensureToken(destinationPath, () => this.statusManager.clearFetchingLock(destinationPath));
            await engine.clone(absoluteDir, repositoryUrl, tokenToUse);

            // Refresh the vault so Obsidian sees the new files
            await this.app.vault.adapter.list(destinationPath);
            
            new Notice(`Shared Space cloned: ${destinationPath}`);
        } catch (error) {
            if (error instanceof Error && error.message === "MISSING_TOKEN") return;
            console.error("Clone space failed", error);
            throw error;
        }
    }

    /**
     * Check if a folder already contains a .git directory.
     */
    async detectExistingGit(vaultPath: string): Promise<boolean> {
        try {
            const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
            const gitPath = path.join(absoluteDir, '.git');
            const stats = await NodeFsAdapter.promises.stat(gitPath).catch(() => null);
            return !!stats && stats.isDirectory();
        } catch (error) {
            console.error("Git detection failed", error);
            return false;
        }
    }

    /**
     * Ensure a .gitignore exists with standard exclusions from SecurityManager.
     */
    private async ensureGitIgnore(absoluteDir: string): Promise<void> {
        const gitIgnorePath = path.join(absoluteDir, '.gitignore');
        const content = this.securityManager.generateGitIgnoreContent();

        try {
            const exists = await NodeFsAdapter.promises.stat(gitIgnorePath).catch(() => null);
            if (!exists) {
                await NodeFsAdapter.promises.writeFile(gitIgnorePath, content, 'utf8');
                console.debug(`[SpaceService] Created default .gitignore at ${gitIgnorePath}`);
            }
        } catch (error) {
            console.error("Failed to ensure .gitignore", error);
        }
    }

    /**
     * Recursively scan for files that violate security rules (e.g., size).
     */
    public async checkForLargeFiles(vaultPath: string): Promise<string[]> {
        const invalidFiles: string[] = [];
        const absoluteDir = this.gitService.getAbsolutePath(vaultPath);

        const scan = async (dir: string) => {
            const entries = await NodeFsAdapter.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.relative(absoluteDir, fullPath);

                if (this.securityManager.isPathExcluded(relativePath)) continue;

                if (entry.isDirectory()) {
                    if (entry.name === '.git') continue;
                    await scan(fullPath);
                } else if (entry.isFile()) {
                    const stats = await NodeFsAdapter.promises.stat(fullPath);
                    const validation = this.securityManager.validateFile(relativePath, stats.size);
                    if (!validation.valid) {
                        invalidFiles.push(`${relativePath} (${validation.reason})`);
                    }
                }
            }
        };

        try {
            await scan(absoluteDir);
        } catch (e) {
            console.error("Scanning for security violations failed", e);
        }
        return invalidFiles;
    }

    /**
     * Initialize a fresh git repository in a folder (for Shared Spaces).
     */
    async initRepository(vaultPath: string): Promise<void> {
         try {
            const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
            await this.ensureGitIgnore(absoluteDir);
            
            // Check if already a repo
            if (await this.detectExistingGit(vaultPath)) {
                console.log(`[SpaceService] ${vaultPath} is already a git repo.`);
                return;
            }

            const engine = await this.gitService.getEngine();
            await engine.init(absoluteDir, 'main');
            
            const author = this.gitService.getSyncAuthor();

            // Add all files (including .gitignore)
            await engine.add(absoluteDir, ".");
            
            // Initial commit
            await engine.commit(absoluteDir, "Initial commit via Abstract Spaces", author);
            
            console.log(`[SpaceService] Initialized git repo at ${vaultPath}`);

         } catch (error) {
            console.error("Failed to init repository", error);
            throw error;
         }
    }

    /**
     * Initialize a personal backup for a folder.
     */
    async initializePersonalBackup(vaultPath: string, repositoryUrl: string, token?: string): Promise<void> {
        // 1. Check for library conflict
        const librariesPath = this.settings.librarySettings?.librariesPath || "Abstract Library";
        if (vaultPath.startsWith(librariesPath)) {
            throw new Error("Cannot backup folders within the Abstract Library directory.");
        }

        try {
            const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
            const tokenToUse = token || await this.gitService.ensureToken();

            // 2. Initial safety checks
            await this.ensureGitIgnore(absoluteDir);
            const largeFiles = await this.checkForLargeFiles(vaultPath);
            if (largeFiles.length > 0) {
                const message = `Warning: ${largeFiles.length} files are larger than 10MB. This may cause sync issues.`;
                new Notice(message);
                console.warn(message, largeFiles);
            }

            // 3. git init
            const engine = await this.gitService.getEngine();
            await engine.init(absoluteDir, 'main');

            // add remote
            await engine.addRemote(absoluteDir, 'origin', repositoryUrl);

            // Initial commit and push
            await this.syncBackup(vaultPath, "Initial backup via Abstract Folder", tokenToUse);
            
            new Notice(`Backup initialized for ${vaultPath}`);
        } catch (error) {
            if (error instanceof Error && error.message === "MISSING_TOKEN") return;
            console.error("Backup initialization failed", error);
            throw error;
        }
    }

    /**
     * Sync changes to the remote (pull, add, commit, push).
     */
    async syncBackup(vaultPath: string, message: string = "Sync via Abstract Folder", token?: string, silent: boolean = false): Promise<void> {
        // Hoist engine so it's accessible in catch block
        let engine: IGitEngine | null = null;
        try {
            const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
            const tokenToUse = token || await this.gitService.ensureToken(vaultPath, () => this.statusManager.clearFetchingLock(vaultPath));
            
            const author = this.gitService.getSyncAuthor();
            engine = await this.gitService.getEngine();
            
            // 1. Add all files
            await engine.add(absoluteDir, ".");

            if (!engine.isDesktopNative()) {
                // 1.5. Remove deleted files
                const matrix = await git.statusMatrix({ fs: NodeFsAdapter, dir: absoluteDir });
                for (const row of matrix) {
                    if (row[2] === 0 && (row[1] !== 0 || row[3] !== 0)) {
                        await engine.remove(absoluteDir, row[0]);
                    }
                }
            }

            // 2. Commit local state
            await engine.commit(absoluteDir, message, author).catch(e => {
                if (e.code === 'NothingToCommitError') return;
                throw e;
            });

            // 3. Pull and merge remote changes
            let currentBranch = "main";
            try {
                currentBranch = await engine.currentBranch(absoluteDir) || "main";
                await engine.pull(absoluteDir, currentBranch, author, tokenToUse);
            } catch (e: any) {
                const msg = e.message || '';
                const isNotFoundError = e.code === 'NotFoundError'
                    || msg.includes('could not find')
                    || msg.includes("couldn't find remote ref")
                    || msg.includes('does not appear to be a git repository')
                    || msg.includes('Repository not found');
                const isTypeError = e instanceof TypeError;
                
                if (isNotFoundError || isTypeError) {
                    console.debug("[SpaceService] Skipping pull: Remote is empty or branch does not exist yet.", e);
                } else {
                    throw e;
                }
            }

            // 4. Push local changes
            await engine.push(absoluteDir, currentBranch, tokenToUse);

            if (!silent) new Notice("Backup synced successfully");
        } catch (error: any) {
            if (error.name === 'CheckoutConflictError') {
                if (this.isConflictModalOpen) return;
                this.isConflictModalOpen = true;
                const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
                const files = error.data?.filepaths || [];

                new ConflictResolutionModal(this.app, vaultPath, files, async (strategy) => {
                    this.isConflictModalOpen = false;
                    if (strategy === 'overwrite') {
                        try {
                            if (engine) await engine.discardChanges(absoluteDir, files);
                            await this.syncBackup(vaultPath, message, token, silent);
                        } catch (e: any) {
                            new Notice(`Sync failed after overwrite: ${e.message}`);
                            Logger.error("[SpaceService] Post-checkout-conflict sync failed", e);
                        }
                    }
                }).open();
                return;
            }

            if (error.code === 'MergeConflictError' || error.name === 'MergeConflictError') {
                const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
                const conflicts = await ConflictManager.detectConflicts(absoluteDir, error);
                
                if (conflicts.length > 0) {
                    new Notice("Merge conflicts detected during backup. Opening Merge UI...");
                    new MergeModal(this.app, absoluteDir, conflicts, async () => {
                        await this.finalizeMerge(absoluteDir, vaultPath, token || await this.gitService.getToken(), silent);
                    }).open();
                    return;
                }
            }
            if (error instanceof Error && error.message === "MISSING_TOKEN") return;
            console.error("Sync failed", error);
            throw error;
        } finally {
            void this.scopeManager.refreshScope(vaultPath);
        }
    }

    /**
     * Set the remote URL for a repository.
     */
    async addRemote(vaultPath: string, url: string): Promise<void> {
        try {
            const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
            const engine = await this.gitService.getEngine();
            await engine.addRemote(absoluteDir, 'origin', url);
            console.log(`[SpaceService] Added remote 'origin' -> ${url} for ${vaultPath}`);
        } catch (error) {
            console.error("Failed to add remote", error);
            throw error;
        }
    }

    /**
     * Finalizes a merge by committing the resolution and pushing to remote.
     */
    async finalizeMerge(absoluteDir: string, vaultPath: string, token: string | undefined, silent: boolean = false): Promise<void> {
        try {
            console.log("[SpaceService] Finalizing merge...");
            const author = this.gitService.getSyncAuthor();
            const engine = await this.gitService.getEngine();
            const headOid = await engine.resolveRef(absoluteDir, 'HEAD');
            let mergeParentOid: string | null = null;
            
            try {
                mergeParentOid = await engine.resolveRef(absoluteDir, 'FETCH_HEAD');
            } catch (e) {
                console.warn("[SpaceService] Could not resolve FETCH_HEAD, trying origin/main");
                try {
                     mergeParentOid = await engine.resolveRef(absoluteDir, 'refs/remotes/origin/main');
                } catch (e2) {
                    console.warn("[SpaceService] Could not resolve origin/main either.");
                }
            }
            
            const parents = [headOid];
            if (mergeParentOid) {
                parents.push(mergeParentOid);
                console.log(`[SpaceService] Creating merge commit with parents: ${parents.join(', ')}`);
            }

            // 1. Commit the merge
            await engine.commit(absoluteDir, `Merge branch 'origin/main' into main`, author, parents);

            // 2. Push the result
            await engine.push(absoluteDir, 'main', token, true);

            console.log("[SpaceService] Merge finalized and pushed successfully.");
            new Notice("Merge resolved and synced successfully!");
        } catch (error) {
            console.error("[SpaceService] Failed to finalize merge:", error);
            new Notice("Failed to finalize merge.");
            throw error;
        } finally {
            void this.scopeManager.refreshScope(vaultPath);
        }
    }

    /**
     * Fetches the commit history for a space.
     */
    async getHistory(vaultPath: string, depth = 10): Promise<any[]> {
        try {
            const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
            const log = await git.log({
                fs: NodeFsAdapter,
                dir: absoluteDir,
                depth,
            });
            return log.map(commit => ({
                oid: commit.oid,
                message: commit.commit.message,
                author: commit.commit.author.name,
                email: commit.commit.author.email,
                timestamp: commit.commit.author.timestamp * 1000, 
            }));
        } catch (error) {
            console.error("[SpaceService] Failed to fetch history", error);
            return [];
        }
    }

    /**
     * Derives a list of collaborators from Git history.
     */
    async getCollaborators(vaultPath: string): Promise<{ name: string; email: string; avatar?: string }[]> {
        try {
            const history = await this.getHistory(vaultPath, 50);
            const collaborators = new Map<string, { name: string; email: string }>();
            
            for (const entry of history) {
                if (!collaborators.has(entry.email)) {
                    collaborators.set(entry.email, { name: entry.author, email: entry.email });
                }
            }

            return Array.from(collaborators.values());
        } catch (error) {
            console.error("[SpaceService] Failed to fetch collaborators", error);
            return [];
        }
    }

    /**
     * Delete a shared space locally and optionally on remote.
     */
    async deleteSharedSpace(vaultPath: string, deleteRemote: boolean): Promise<void> {
        try {
            // 1. Stop Sync Engine
            this.stopSyncEngineCallback(vaultPath);

            // 2. Get Remote Info
            let remoteUrl: string | null = "";
            if (deleteRemote) {
                const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
                const engine = await this.gitService.getEngine();
                remoteUrl = await engine.getConfig(absoluteDir, 'remote.origin.url') || null;
            }

            // 3. Delete Local Folder
            const absPath = this.gitService.getAbsolutePath(vaultPath);
            await NodeFsAdapter.promises.rm(absPath, { recursive: true, force: true });

            // 4. Remove from settings
            if (this.settings.librarySettings.sharedSpaces) {
                this.settings.librarySettings.sharedSpaces = this.settings.librarySettings.sharedSpaces.filter(p => p !== vaultPath);
                const plugin = (this.app as any).plugins?.getPlugin?.("abstract-folder");
                if (plugin) await plugin.saveSettings();
            }

            // 5. Delete on GitHub
            if (deleteRemote && remoteUrl) {
                const token = await this.gitService.getToken();
                if (token) {
                    const info = this.parseGitHubUrl(remoteUrl);
                    if (info) {
                        const success = await AuthService.deleteRepository(token, info.owner, info.repo);
                        if (success) {
                            new Notice(`Deleted repository "${info.owner}/${info.repo}" on GitHub.`);
                        }
                    }
                }
            }

            this.app.workspace.trigger("abstract-folder:spaces-updated");
            new Notice(`Successfully deleted space: ${path.basename(vaultPath)}`);
        } catch (error) {
            Logger.error(`[SpaceService] Failed to delete space ${vaultPath}`, error);
            throw error;
        }
    }

    private parseGitHubUrl(url: string): { owner: string; repo: string } | null {
        const httpsRegex = /github\.com[\/|:]([^\/]+)\/([^\/\.]+)(\.git)?$/;
        const match = url.match(httpsRegex);
        if (match) {
            return { owner: match[1], repo: match[2] };
        }
        return null;
    }

    /**
     * Prunes missing directories from settings.
     */
    public async pruneMissingRepositories(): Promise<void> {
        let changed = false;
        const { stat } = require('fs/promises');

        const prune = async (list: string[]) => {
            const newList: string[] = [];
            for (const vaultPath of list) {
                if (vaultPath === "") {
                    newList.push(vaultPath);
                    continue;
                }

                const absPath = this.gitService.getAbsolutePath(vaultPath);
                try {
                    await stat(absPath);
                    newList.push(vaultPath);
                } catch {
                    Logger.warn(`[SpaceService] Pruning missing repository from settings: "${vaultPath}"`);
                    changed = true;
                }
            }
            return newList;
        };

        if (this.settings.librarySettings.sharedSpaces) {
            this.settings.librarySettings.sharedSpaces = await prune(this.settings.librarySettings.sharedSpaces);
        }

        if (this.settings.librarySettings.personalBackups) {
            this.settings.librarySettings.personalBackups = await prune(this.settings.librarySettings.personalBackups);
        }

        if (changed) {
            const plugin = (this.app as any).plugins?.getPlugin?.("abstract-folder");
            if (plugin) await plugin.saveSettings();
        }
    }
}
