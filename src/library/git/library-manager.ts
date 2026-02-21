import { App, Notice, FileSystemAdapter, EventRef, Platform } from "obsidian";
import * as git from "isomorphic-git";
import * as path from 'path';
import { ObsidianHttpAdapter } from "./http-adapter";
import { LibraryConfig, LibraryStatus, CatalogItem } from "../types";
import { DataService } from "../services/data-service";
import { NodeFsAdapter } from "./node-fs-adapter";
import { SecureFsAdapter } from "./secure-fs-adapter";
import { AbstractFolderPluginSettings } from "../../settings";
import { AuthService } from "../services/auth-service";
import { ConflictManager } from "./conflict-manager";
import { MergeModal } from "../../ui/modals/merge/merge-modal";
import { SecurityManager } from "../../core/security-manager";
import { GitScopeManager } from "./git-scope-manager";
import { GitDesktopAdapter } from "./git-desktop-adapter";
import { GitMobileAdapter } from "./git-mobile-adapter";
import { GitStatusMatrix, IGitEngine, GitAuthor } from "./types";
import { ConflictResolutionModal } from "../../ui/modals/conflict-resolution-modal";
import { Logger } from "../../utils/logger";

/**
 * LibraryManager handles Git operations using isomorphic-git.
 * It uses a physical Node FS adapter to sync files directly to the vault.
 */
export class LibraryManager {
    public readonly scopeManager: GitScopeManager;
    private gitDesktopAdapter: GitDesktopAdapter;
    private gitMobileAdapter: GitMobileAdapter;
    private hasNativeGit: boolean | undefined = undefined;

    // Cache includes isFetching lock
    private cache: Map<string, { dirty: boolean; isFetching: boolean; data: GitStatusMatrix }> = new Map();
    // Idle-Detection Debouncer Map for Smart Background Sync
    private syncTimers: Map<string, NodeJS.Timeout> = new Map();
    private windowFocusListener: () => void;
    private vaultRefs: EventRef[] = [];

    constructor(
        private app: App, 
        private settings: AbstractFolderPluginSettings,
        private securityManager: SecurityManager
    ) {
        this.scopeManager = new GitScopeManager(app);
        this.gitDesktopAdapter = new GitDesktopAdapter();
        this.gitMobileAdapter = new GitMobileAdapter(this.securityManager);

        // Reactive Cache Invalidation Hooks (Stored for Cleanup)
        this.vaultRefs.push(this.app.vault.on('modify', (file) => this.flagCacheDirty(file.path)));
        this.vaultRefs.push(this.app.vault.on('create', (file) => this.flagCacheDirty(file.path)));
        this.vaultRefs.push(this.app.vault.on('delete', (file) => this.flagCacheDirty(file.path)));

        // Window Focus Listener: Force cache invalidation when returning to the app
        this.windowFocusListener = () => {
            for (const vaultPath of this.cache.keys()) {
                this.flagCacheDirtyByPath(vaultPath);
            }
        };
        window.addEventListener('focus', this.windowFocusListener);
    }

    private async getEngine(): Promise<IGitEngine> {
        if (this.hasNativeGit !== undefined) {
            return this.hasNativeGit ? this.gitDesktopAdapter : this.gitMobileAdapter;
        }
        if (Platform.isDesktop) {
            try {
                const { promisify } = require('util');
                const { execFile } = require('child_process');
                const execFileAsync = promisify(execFile);
                await execFileAsync('git', ['--version']);
                this.hasNativeGit = true;
            } catch (e) {
                console.warn("[LibraryManager] Native git not found, falling back to isomorphic-git", e);
                this.hasNativeGit = false;
            }
        } else {
            this.hasNativeGit = false;
        }
        return this.hasNativeGit ? this.gitDesktopAdapter : this.gitMobileAdapter;
    }

    /**
     * Check if the native git binary is available on this system.
     * Unlike getEngine(), this is purely a capability probe and does not cache.
     */
    async checkNativeGit(): Promise<boolean> {
        if (!Platform.isDesktop) return false;
        try {
            const { promisify } = require('util');
            const { execFile } = require('child_process');
            const execFileAsync = promisify(execFile);
            await execFileAsync('git', ['--version']);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Fetch and cache GitHub user info.
     */
    async refreshIdentity(providedToken?: string): Promise<{ login: string; avatar_url: string; name: string | null; email: string | null } | null> {
        const token = providedToken || await this.getToken();
        if (!token) return null;

        const userInfo = await AuthService.getUserInfo(token);
        if (userInfo) {
            this.settings.librarySettings.githubUsername = userInfo.login;
            this.settings.librarySettings.githubAvatar = userInfo.avatar_url;
            
            // Be very explicit about fallback
            const name = userInfo.name || userInfo.login;
            const email = userInfo.email || `${userInfo.login}@users.noreply.github.com`;
            
            this.settings.librarySettings.gitName = name;
            this.settings.librarySettings.gitEmail = email;
            
            // Explicitly try to save settings
            try {
                const plugin = (this.app as any).plugins.getPlugin("abstract-folder");
                if (plugin) {
                    await plugin.saveSettings();
                } else {
                    console.error("[LibraryManager] Could not find plugin instance to save settings.");
                }
            } catch (e) {
                console.error("[LibraryManager] Failed to save settings during refreshIdentity:", e);
            }
        }
        return userInfo;
    }

    /**
     * Get counts of unstaged, uncommitted, and unpushed changes.
     */
    async getSyncStatus(vaultPath: string): Promise<{ ahead: number; dirty: number }> {
        try {
            const engine = await this.getEngine();
            const absoluteDir = this.getAbsolutePath(vaultPath);
            // Status check is read-only, safe to use NodeFsAdapter for speed
            const matrix = await engine.getStatusMatrix(absoluteDir);
            
            // row[1] = head, row[2] = workdir, row[3] = stage
            // unmodified: [1,1,1], modified: [1,2,1], staged: [1,2,2], added: [0,2,2], deleted: [1,0,0]
            // For the new mapping: 'synced', 'modified', 'conflict', 'untracked'
            let dirty = 0;
            for (const status of matrix.values()) {
                if (status !== 'synced') dirty++;
            }

            // Ahead count (commits not on remote)
            // This is a bit more complex with isomorphic-git, for now let's focus on dirty count
            // or use git.log comparing local and remote branches if possible.
            
            return { ahead: 0, dirty }; 
        } catch (e) {
            return { ahead: 0, dirty: 0 };
        }
    }

    public async getToken(): Promise<string | undefined> {
        if (this.app?.secretStorage && typeof this.app.secretStorage.getSecret === 'function') {
            try {
                return await this.app.secretStorage.getSecret('abstract-folder-github-pat') || undefined;
            } catch (e: any) {
                // Notice: On some Linux distributions or Obsidian versions, secretStorage is present 
                // but throws TypeError or errors due to missing keychain access.
                if (e instanceof TypeError && e.message.includes('this.app.getSecret is not a function')) {
                    try {
                        return await this.app.secretStorage.getSecret.call(this.app, 'abstract-folder-github-pat') || undefined;
                    } catch (e2) {
                        Logger.warn("[LibraryManager] SecretStorage context fallback failed.", e2);
                    }
                } else {
                    Logger.warn("[LibraryManager] Failed to get secret from SecretStorage (keychain may be unavailable)", e);
                }
            }
        }
        return this.settings?.librarySettings?.githubToken;
    }

    /**
     * Ensures a token is available, otherwise throws and notifies the user.
     */
    private async ensureToken(vaultPath?: string): Promise<string> {
        const token = await this.getToken();
        if (!token) {
            new Notice("🔒 GitHub PAT missing. Please configure it in the Abstract Folder settings to enable Git Sync.");
            if (vaultPath) this.clearFetchingLock(vaultPath);
            throw new Error("MISSING_TOKEN");
        }
        return token;
    }

    private clearFetchingLock(vaultPath: string) {
        const cached = this.cache.get(vaultPath);
        if (cached) {
            cached.isFetching = false;
        }
    }

    /**
     * Helper to get absolute path on disk from vault path.
     */
    private getAbsolutePath(vaultPath: string): string {
        if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
            throw new Error("Vault is not on a physical filesystem");
        }
        return path.join(this.app.vault.adapter.getBasePath(), vaultPath);
    }

    /**
     * Clone a library into the vault.
     */
    async cloneLibrary(repositoryUrl: string, destinationPath: string, item?: CatalogItem, token?: string): Promise<void> {
        try {
            const absoluteDir = this.getAbsolutePath(destinationPath);

            // Ensure the directory exists before cloning into it with '.'
            await NodeFsAdapter.promises.mkdir(absoluteDir, { recursive: true });

            const engine = await this.getEngine();
            const tokenToUse = token || await this.ensureToken(destinationPath);
            await engine.clone(absoluteDir, repositoryUrl, tokenToUse);

            console.debug(`[LibraryManager] Clone complete for ${absoluteDir}. Verifying contents...`);
            try {
                const configPath = path.join(absoluteDir, 'library.json');
                const configExists = await NodeFsAdapter.promises.stat(configPath).catch(() => null);

                if (!configExists) {
                    if (item) {
                        const manifest: LibraryConfig = {
                            id: item.id || `gen-${item.name.toLowerCase().replace(/\s+/g, '-')}`,
                            name: item.name,
                            author: item.author,
                            version: "1.0.0",
                            description: item.description,
                            repositoryUrl: item.repositoryUrl,
                            branch: "main"
                        };
                        await NodeFsAdapter.promises.writeFile(configPath, JSON.stringify(manifest, null, 2), "utf8");
                        console.debug(`[LibraryManager] Created bootstrap manifest at ${configPath}`);
                    } else {
                        throw new Error("Library is missing library.json and no metadata was provided for bootstrapping.");
                    }
                }
            } catch (e) {
                console.error(`[LibraryManager] Post-clone verification/bootstrapping failed for ${absoluteDir}:`, e);
                throw e; 
            }

            // Refresh the vault so Obsidian sees the new files
            await this.app.vault.adapter.list(destinationPath);
            
            new Notice(`Library installed: ${destinationPath}`);
        } catch (error) {
            if (error instanceof Error && error.message === "MISSING_TOKEN") return;
            console.error("Clone failed", error);
            throw error;
        }
    }

    /**
     * Clone a shared space (collaborative folder).
     * Does NOT enforce library.config.json.
     */
    async cloneSpace(repositoryUrl: string, destinationPath: string, token?: string): Promise<void> {
        try {
            const absoluteDir = this.getAbsolutePath(destinationPath);

            // Ensure the directory exists before cloning into it with '.'
            await NodeFsAdapter.promises.mkdir(absoluteDir, { recursive: true });

            const engine = await this.getEngine();
            const tokenToUse = token || await this.ensureToken(destinationPath);
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

    // Static flag to prevent multiple conflict modals from opening simultaneously
    private isConflictModalOpen = false;

    /**
     * Pull updates for an existing library.
     */
    async updateLibrary(vaultPath: string, token?: string): Promise<void> {
        try {
            const absoluteDir = this.getAbsolutePath(vaultPath);
            const engine = await this.getEngine();
            const tokenToUse = token || await this.ensureToken(vaultPath);

            const gitSettings = this.settings.librarySettings;
            const author = {
                name: gitSettings.gitName || gitSettings.githubUsername || "Abstract Library Manager",
                email: gitSettings.gitEmail || (gitSettings.githubUsername ? `${gitSettings.githubUsername}@users.noreply.github.com` : "manager@abstract.library")
            };

            await engine.pull(absoluteDir, "main", author, tokenToUse);

            // Refresh vault and invalidate bridge cache so the tree shows updated files
            await this.app.vault.adapter.list(vaultPath);
            (this.app.workspace as any).trigger('abstract-folder:spaces-updated');

            new Notice("Library updated successfully");
        } catch (error: any) {
            if (error.name === 'CheckoutConflictError') {
                // Prevent duplicate modals if update is called multiple times rapidly
                if (this.isConflictModalOpen) return;
                this.isConflictModalOpen = true;

                const files = error.data?.filepaths || [];
                new ConflictResolutionModal(this.app, vaultPath, files, async (strategy) => {
                    this.isConflictModalOpen = false;
                    if (strategy === 'overwrite') {
                        try {
                            const absoluteDir = this.getAbsolutePath(vaultPath);
                            const engine = await this.getEngine();
                            const tokenToUse = token || await this.ensureToken(vaultPath);
                            const gitSettings = this.settings.librarySettings;
                            const author = {
                                name: gitSettings.gitName || gitSettings.githubUsername || "Abstract Library Manager",
                                email: gitSettings.gitEmail || (gitSettings.githubUsername ? `${gitSettings.githubUsername}@users.noreply.github.com` : "manager@abstract.library")
                            };

                            new Notice("Overwriting local changes and pulling...");
                            await engine.discardChanges(absoluteDir, files);

                            // Single retry — if this fails again, it's a different error (not conflict)
                            await engine.pull(absoluteDir, "main", author, tokenToUse);

                            // Invalidate bridge + graph cache so the file tree reflects new state
                            const bridge = (this.app as any).plugins?.plugins?.['abstract-folder']?.abstractBridge;
                            if (bridge) bridge.invalidateCache();

                            await this.app.vault.adapter.list(vaultPath);
                            (this.app.workspace as any).trigger('abstract-folder:spaces-updated');

                            new Notice("Library updated successfully");
                        } catch (e: any) {
                            new Notice(`Resolution failed: ${e.message}`);
                            Logger.error("[LibraryManager] Post-conflict pull failed", e);
                        }
                    }
                }).open();
                return;
            }

            if (error.code === 'MergeConflictError' || error.name === 'MergeConflictError') {
                const absoluteDir = this.getAbsolutePath(vaultPath);
                const conflicts = await ConflictManager.detectConflicts(absoluteDir);
                if (conflicts.length > 0) {
                    new Notice("Merge conflicts detected. Opening Merge UI...");
                    new MergeModal(this.app, absoluteDir, conflicts, async () => {
                        await this.app.vault.adapter.list(vaultPath);
                        new Notice("Merge resolved and updated.");
                    }).open();
                    return;
                }
            }
            if (error instanceof Error && error.message === "MISSING_TOKEN") return;
            console.error("Update failed", error);
            throw error;
        } finally {
            void this.scopeManager.refreshScope(vaultPath);
        }
    }

    /**
     * Check the status of the library.
     */
    async getStatus(vaultPath: string): Promise<LibraryStatus> {
        try {
            const absoluteDir = this.getAbsolutePath(vaultPath);
            const engine = await this.getEngine();
            const matrix = await engine.getStatusMatrix(absoluteDir);
            
            let isDirty = false;
            for (const status of matrix.values()) {
                if (status !== 'synced') {
                    isDirty = true;
                    break;
                }
            }
            return isDirty ? 'dirty' : 'up-to-date';
        } catch (error) {
            console.error("Status check failed", error);
            return 'error';
        }
    }

    /**
     * Validate library.config.json in the library folder.
     */
    async validateLibrary(vaultPath: string): Promise<LibraryConfig> {
        const absoluteDir = this.getAbsolutePath(vaultPath);
        const configPath = path.join(absoluteDir, 'library.json');
        
        try {
            const configContent = await NodeFsAdapter.promises.readFile(configPath, "utf8");
            return DataService.parseLibraryConfig(configContent);
        } catch (error) {
            // Only alert if the file exists but we failed to parse it
            if (error.code !== 'ENOENT') {
                console.error(`Validation failed for ${vaultPath}:`, error);
            }
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to validate library at ${vaultPath}: ${message}`);
        }
    }

    /**
     * Delete a library from the physical filesystem and vault.
     */
    async deleteLibrary(vaultPath: string): Promise<void> {
        try {
            const absoluteDir = this.getAbsolutePath(vaultPath);
            
            // Recursive deletion using Node-FS
            const removeRecursive = async (absPath: string) => {
                const stats = await NodeFsAdapter.promises.stat(absPath).catch(() => null);
                if (!stats) return;

                if (stats.isDirectory()) {
                    const entries = await NodeFsAdapter.promises.readdir(absPath);
                    for (const entry of entries) {
                        await removeRecursive(path.join(absPath, entry));
                    }
                    await NodeFsAdapter.promises.rmdir(absPath);
                } else {
                    await NodeFsAdapter.promises.unlink(absPath);
                }
            };

            await removeRecursive(absoluteDir);
            
            // Refresh vault to reflect changes
            await this.app.vault.adapter.list(path.dirname(vaultPath));

            new Notice("Library deleted successfully");
        } catch (error) {
            console.error("Delete failed", error);
            throw error;
        }
    }

    /**
     * Determine if the current user is the owner of the library.
     * Uses a multi-layered check:
     * 1. Manifest author name (case-insensitive)
     * 2. Actual Git Remote URL (source of truth)
     */
    async isLibraryOwner(vaultPath: string): Promise<{ isOwner: boolean; author: string; repositoryUrl: string | null }> {
        try {
            // Shared Spaces might not have library.config.json, so we make this resilient
            const config = await this.validateLibrary(vaultPath).catch(() => null);
            const author = config?.author || "Unknown";
            
            const username = this.settings.librarySettings.githubUsername;
            const gitName = this.settings.librarySettings.gitName;
            
            // 1. Check Author Name (Display/Legacy) - Only possible if config exists
            const nameMatch = config ? ((username?.toLowerCase() === author.toLowerCase()) || 
                             (gitName?.toLowerCase() === author.toLowerCase())) : false;
            
            // 2. Check Actual Git Remote (Most robust source of truth)
            const actualRemote = await this.getRemoteUrl(vaultPath);
            const manifestRemote = config?.repositoryUrl;
            
            let repoMatch = false;
            const checkUrl = actualRemote || manifestRemote;
            if (username && checkUrl) {
                const lowerRepo = checkUrl.toLowerCase();
                const lowerUser = username.toLowerCase();
                repoMatch = lowerRepo.includes(`github.com/${lowerUser}/`) || 
                           lowerRepo.includes(`github.com:${lowerUser}/`);
            }

            return { isOwner: nameMatch || repoMatch, author, repositoryUrl: checkUrl ?? null };
        } catch (error) {
            console.error("[LibraryManager] Failed to determine library ownership", error);
            return { isOwner: false, author: "Unknown", repositoryUrl: null };
        }
    }

    /**
     * Get the remote URL for the library.
     */
    async getRemoteUrl(vaultPath: string): Promise<string | null> {
        try {
            const absoluteDir = this.getAbsolutePath(vaultPath);
            const engine = await this.getEngine();
            const url = await engine.getConfig(absoluteDir, 'remote.origin.url');
            return url || null;
        } catch (error) {
            // This is expected for non-git folders
            return null;
        }
    }

    /**
     * Check if a folder already contains a .git directory.
     */
    async detectExistingGit(vaultPath: string): Promise<boolean> {
        try {
            const absoluteDir = this.getAbsolutePath(vaultPath);
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
                console.debug(`[LibraryManager] Created default .gitignore at ${gitIgnorePath}`);
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
        const absoluteDir = this.getAbsolutePath(vaultPath);

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
            const absoluteDir = this.getAbsolutePath(vaultPath);
            const secureFs = new SecureFsAdapter(this.securityManager, absoluteDir);
            await this.ensureGitIgnore(absoluteDir);
            
            // Check if already a repo
            if (await this.detectExistingGit(vaultPath)) {
                console.log(`[LibraryManager] ${vaultPath} is already a git repo.`);
                return;
            }

            const engine = await this.getEngine();
            await engine.init(absoluteDir, 'main');
            
            const gitSettings = this.settings.librarySettings;
            const author = { 
                name: gitSettings.gitName || gitSettings.githubUsername || "Abstract Folder", 
                email: gitSettings.gitEmail || (gitSettings.githubUsername ? `${gitSettings.githubUsername}@users.noreply.github.com` : "shared@abstract.folder")
            };

            // Add all files (including .gitignore)
            await engine.add(absoluteDir, ".");
            
            // Initial commit
            await engine.commit(absoluteDir, "Initial commit via Abstract Spaces", author);
            
            console.log(`[LibraryManager] Initialized git repo at ${vaultPath}`);

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
            const absoluteDir = this.getAbsolutePath(vaultPath);
            const secureFs = new SecureFsAdapter(this.securityManager, absoluteDir);
            const tokenToUse = token || await this.ensureToken();

            // 2. Initial safety checks
            await this.ensureGitIgnore(absoluteDir);
            const largeFiles = await this.checkForLargeFiles(vaultPath);
            if (largeFiles.length > 0) {
                const message = `Warning: ${largeFiles.length} files are larger than 10MB. This may cause sync issues.`;
                new Notice(message);
                console.warn(message, largeFiles);
            }

            // 3. git init
            const engine = await this.getEngine();
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
        // Hoist engine so it's accessible in catch block (for CheckoutConflictError discard)
        let engine: IGitEngine | null = null;
        try {
            const absoluteDir = this.getAbsolutePath(vaultPath);
            const secureFs = new SecureFsAdapter(this.securityManager, absoluteDir);
            const tokenToUse = token || await this.ensureToken(vaultPath);
            
            const gitSettings = this.settings.librarySettings;
            const author = { 
                name: gitSettings.gitName || gitSettings.githubUsername || "Abstract Folder", 
                email: gitSettings.gitEmail || (gitSettings.githubUsername ? `${gitSettings.githubUsername}@users.noreply.github.com` : "backup@abstract.folder")
            };

            engine = await this.getEngine();
            
            // 1. Add all files (handles modified & untracked)
            await engine.add(absoluteDir, ".");

            if (!engine.isDesktopNative()) {
                // 1.5. Remove deleted files (isomorphic-git does not stage deletions via `add .`)
                const matrix = await git.statusMatrix({ fs: NodeFsAdapter, dir: absoluteDir });
                for (const row of matrix) {
                    // row[1] = head, row[2] = workdir, row[3] = stage
                    // If workdir is 0 (absent) but head/stage is 1/2 (tracked/added), it was deleted
                    if (row[2] === 0 && (row[1] !== 0 || row[3] !== 0)) {
                        await engine.remove(absoluteDir, row[0]);
                    }
                }
            }


            // 2. Commit local state to ensure atomic merge
            await engine.commit(absoluteDir, message, author).catch(e => {
                // If there's nothing to commit, commit throws an error. We can safely ignore it.
                if (e.code === 'NothingToCommitError') return;
                throw e;
            });

            // 3. Pull and merge remote changes
            let currentBranch = "main";
            try {
                currentBranch = await engine.currentBranch(absoluteDir) || "main";
                
                await engine.pull(absoluteDir, currentBranch, author, tokenToUse);
            } catch (e: any) {
                // Handle various "new repo" edge cases where the remote exists but has no commits/branches yet.
                // isomorphic-git: 'NotFoundError' / 'could not find'
                // native git:     "couldn't find remote ref <branch>" (brand-new empty repo)
                //                 "does not appear to be a git repository" (repo created but unconfigured)
                const msg = e.message || '';
                const isNotFoundError = e.code === 'NotFoundError'
                    || msg.includes('could not find')
                    || msg.includes("couldn't find remote ref")
                    || msg.includes('does not appear to be a git repository')
                    || msg.includes('Repository not found');
                const isTypeError = e instanceof TypeError;
                
                if (isNotFoundError || isTypeError) {
                    console.debug("[LibraryManager] Skipping pull: Remote is empty or branch does not exist yet. Proceeding with push-only.", e);
                } else {
                    throw e;
                }
            }

            // 4. Push local changes
            await engine.push(absoluteDir, currentBranch, tokenToUse);

            if (!silent) new Notice("Backup synced successfully");
        } catch (error: any) {
            if (error.name === 'CheckoutConflictError') {
                // Checkout conflict: local uncommitted changes would be overwritten
                if (this.isConflictModalOpen) return;
                this.isConflictModalOpen = true;
                const absoluteDir = this.getAbsolutePath(vaultPath);
                const files = error.data?.filepaths || [];

                new ConflictResolutionModal(this.app, vaultPath, files, async (strategy) => {
                    this.isConflictModalOpen = false;
                    if (strategy === 'overwrite') {
                        try {
                            if (engine) await engine.discardChanges(absoluteDir, files);
                            await this.syncBackup(vaultPath, message, token, silent);
                        } catch (e: any) {
                            new Notice(`Sync failed after overwrite: ${e.message}`);
                            Logger.error("[LibraryManager] Post-checkout-conflict sync failed", e);
                        }
                    }
                }).open();
                return;
            }

            if (error.code === 'MergeConflictError' || error.name === 'MergeConflictError') {
                const absoluteDir = this.getAbsolutePath(vaultPath);
                const conflicts = await ConflictManager.detectConflicts(absoluteDir, error);
                
                if (conflicts.length > 0) {
                    new Notice("Merge conflicts detected during backup. Opening Merge UI...");
                    new MergeModal(this.app, absoluteDir, conflicts, async () => {
                        // After resolution, we must COMMIT the merge to clear the conflict state, then push.
                        await this.finalizeMerge(absoluteDir, vaultPath, token || await this.getToken(), silent);
                    }).open();
                    return;
                } else {
                    console.warn("[LibraryManager] MergeConflictError caught but no conflicts detected by ConflictManager.");
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
            const absoluteDir = this.getAbsolutePath(vaultPath);
            const engine = await this.getEngine();
            await engine.addRemote(absoluteDir, 'origin', url);
            console.log(`[LibraryManager] Added remote 'origin' -> ${url} for ${vaultPath}`);
        } catch (error) {
            console.error("Failed to add remote", error);
            throw error;
        }
    }
    /**
     * Finalizes a merge by committing the resolution and pushing to remote.
     * This skips the 'pull' step to avoid re-triggering conflict errors.
     */
    async finalizeMerge(absoluteDir: string, vaultPath: string, token: string | undefined, silent: boolean = false): Promise<void> {
        try {
            console.log("[LibraryManager] Finalizing merge...");
            const secureFs = new SecureFsAdapter(this.securityManager, absoluteDir);
            const gitSettings = this.settings.librarySettings;
            const author = { 
                name: gitSettings.gitName || gitSettings.githubUsername || "Abstract Folder", 
                email: gitSettings.gitEmail || (gitSettings.githubUsername ? `${gitSettings.githubUsername}@users.noreply.github.com` : "backup@abstract.folder")
            };

            const engine = await this.getEngine();
            // Resolve parents for the merge commit
            // We need to explicitly link the remote commit we just merged with, 
            // otherwise the push will be rejected as non-fast-forward.
            // These reads are safe with NodeFs or SecureFs (passthrough).
            const headOid = await engine.resolveRef(absoluteDir, 'HEAD');
            let mergeParentOid: string | null = null;
            
            try {
                mergeParentOid = await engine.resolveRef(absoluteDir, 'FETCH_HEAD');
            } catch (e) {
                console.warn("[LibraryManager] Could not resolve FETCH_HEAD, trying origin/main");
                try {
                     mergeParentOid = await engine.resolveRef(absoluteDir, 'refs/remotes/origin/main');
                } catch (e2) {
                    console.warn("[LibraryManager] Could not resolve origin/main either. Proceeding with single parent commit (may cause fast-forward issues).");
                }
            }
            
            const parents = [headOid];
            if (mergeParentOid) {
                parents.push(mergeParentOid);
                console.log(`[LibraryManager] Creating merge commit with parents: ${parents.join(', ')}`);
            }

            // 1. Commit the merge
            await engine.commit(absoluteDir, `Merge branch 'origin/main' into main`, author, parents);

            // 2. Push the result (force to overwrite remote if we resolved conflicts differently)
            await engine.push(absoluteDir, 'main', token, true);

            console.log("[LibraryManager] Merge finalized and pushed successfully.");
            new Notice("Merge resolved and synced successfully!");
        } catch (error) {
            console.error("[LibraryManager] Failed to finalize merge:", error);
            new Notice("Failed to finalize merge. Check console for details.");
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
            const absoluteDir = this.getAbsolutePath(vaultPath);
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
                timestamp: commit.commit.author.timestamp * 1000, // Convert to ms
            }));
        } catch (error) {
            console.error("[LibraryManager] Failed to fetch history", error);
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
            console.error("[LibraryManager] Failed to fetch collaborators", error);
            return [];
        }
    }

    private flagCacheDirty(filePath: string) {
        // Longest-Prefix Match: Implement by sorting keys by length descending
        // to ensure specific sub-repos (spaces/libraries) are prioritized over the vault root ("").
        const sortedRepos = Array.from(this.cache.keys()).sort((a, b) => b.length - a.length);

        for (const vaultPath of sortedRepos) {
            if (filePath.startsWith(vaultPath + '/') || filePath === vaultPath || (vaultPath === "" && filePath !== "")) {
                Logger.debug(`[LibraryManager] Flagging cache dirty for repo: "${vaultPath}" due to file: ${filePath}`);
                this.flagCacheDirtyByPath(vaultPath);
                return;
            }
        }
    }

    public flagCacheDirtyByPath(vaultPath: string) {
        const currentCache = this.cache.get(vaultPath);
        if (currentCache) {
            currentCache.dirty = true;
        }

        // Smart Background Coordinator: Idle-Detection Debouncer
        // If a user keeps typing, we clear and reset the 3-second timer.
        if (this.syncTimers.has(vaultPath)) {
            clearTimeout(this.syncTimers.get(vaultPath)!);
        }
        
        const timer = setTimeout(() => {
            this.syncTimers.delete(vaultPath);
            // Proactive sync
            void this.getFileStatuses(vaultPath);
        }, 3000); // 3 seconds of idle time required
        
        this.syncTimers.set(vaultPath, timer);
    }

    /**
     * Retrieves the instantly accessible cached Git status for any file path,
     * interrogating out all known sub-repositories (spaces/libraries).
     */
    public getCachedStatusForPath(filePath: string): 'synced' | 'modified' | 'conflict' | 'untracked' | null {
        // Sort by length descending to match the most specific sub-repo first
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

        // 1. Return immediately if we have a clean cache
        if (cached && !cached.dirty) {
            return cached.data;
        }

        // 2. Dispatch background request if dirty and NOT currently fetching (SWR Concurrency Lock)
        if (!cached || (!cached.isFetching && cached.dirty)) {
            // Viewport Gating Optimization
            // We only actually fetch if the user is looking at this repository or its children.
            // If they aren't, we leave the cache marked 'dirty' for later.
            let isVisible = false;
            // The Library Explorer and Spaces Explorer both use 'ContextEngine'. 
            // We can look at the workspaces to find active Explorers.
            const leaves = this.app.workspace.getLeavesOfType("abstract-folder-view").concat(
                this.app.workspace.getLeavesOfType("abstract-spaces-explorer"),
                this.app.workspace.getLeavesOfType("abstract-library-explorer")
            );
            
            for (const leaf of leaves) {
                const view = leaf.view as any;
                if (view.contextEngine) {
                    const activePaths = view.contextEngine.getActiveRepositoryPaths();
                    // Just being conservative: 
                    // If the root is in the active set or size is 0 (root folder is selected/expanded), it's visible.
                    // For spaces/libraries, the root itself is usually the scope.
                    if (activePaths.size === 0 || Array.from(activePaths).some((p: string) => p.startsWith(vaultPath) || vaultPath.startsWith(p))) {
                        isVisible = true;
                        break;
                    }
                }
            }

            if (!isVisible && cached) {
               // Leave dirty for when user expands it
               return cached.data;
            }

            // Set up initial cache or lock it
            if (!cached) {
                cached = { dirty: true, isFetching: true, data: new Map() };
                this.cache.set(vaultPath, cached);
            } else {
                cached.isFetching = true; // Lock
            }

            const absoluteDir = this.getAbsolutePath(vaultPath);
            
            // Calculate sub-repository exclusions to optimize fetches (especially for mobile/isomorphic-git)
            const ignoredPaths: string[] = [];
            for (const otherPath of this.cache.keys()) {
                if (otherPath === vaultPath) continue;
                
                if (vaultPath === "") {
                    // Root repo: ignore all other specific repositories
                    ignoredPaths.push(otherPath);
                } else if (otherPath.startsWith(vaultPath + "/")) {
                    // Scoped repo: ignore any nested repositories
                    ignoredPaths.push(otherPath.substring(vaultPath.length + 1));
                }
            }

            // Background Promise
            this.fetchStatusWithFailover(absoluteDir, ignoredPaths)
                .then((freshMatrix) => {
                    const currentCache = this.cache.get(vaultPath);
                    if (currentCache) { // ensure it wasn't deleted
                        currentCache.dirty = false;
                        currentCache.isFetching = false;
                        currentCache.data = freshMatrix;
                    }
                    console.debug(`[LibraryManager] Background git refresh complete for ${vaultPath} (${freshMatrix.size} files)`);
                    // Emit event silently so VirtualViewportV2 can repaint
                    this.app.workspace.trigger('abstract-folder:git-refreshed', vaultPath);
                })
                .catch((error) => {
                    console.error(`[LibraryManager] Failed to fetch git status for ${vaultPath}`, error);
                    // Release the lock so it can try again on the next interaction
                    const currentCache = this.cache.get(vaultPath);
                    if (currentCache) {
                        currentCache.isFetching = false;
                    }
                });
        }

        // 3. Instantly return stale data if we have it (zero blocking!)
        return cached!.data; // UI renders stale state immediately (<2ms)
    }

    // Handles the Desktop adapter hard-fails (Fallback)
    private async fetchStatusWithFailover(absoluteDir: string, ignoredPaths?: string[]): Promise<GitStatusMatrix> {
        if (Platform.isDesktop) {
            try {
                const matrix = await this.gitDesktopAdapter.getStatusMatrix(absoluteDir, ignoredPaths);
                console.debug(`[LibraryManager] Git status fetched via Desktop Adapter for ${absoluteDir}`);
                return matrix;
            } catch (e: any) {
                if (e.message === 'GIT_NOT_FOUND') {
                    console.warn(`[LibraryManager] Native git not found for ${absoluteDir}, falling back to isomorphic-git Worker.`);
                    const matrix = await this.gitMobileAdapter.getStatusMatrix(absoluteDir, ignoredPaths);
                    console.debug(`[LibraryManager] Git status fetched via Mobile (Worker) Adapter for ${absoluteDir}`);
                    return matrix;
                }
                throw e;
            }
        } else {
            const matrix = await this.gitMobileAdapter.getStatusMatrix(absoluteDir, ignoredPaths);
            console.debug(`[LibraryManager] Git status fetched via Mobile (Worker) Adapter for ${absoluteDir}`);
            return matrix;
        }
    }

    public cleanup() {
        this.gitMobileAdapter.terminate();
        window.removeEventListener('focus', this.windowFocusListener);

        // Safely unregister Obsidian events
        this.vaultRefs.forEach(ref => this.app.vault.offref(ref));
    }
}
