import { App, Notice, FileSystemAdapter } from "obsidian";
import * as git from "isomorphic-git";
import * as path from 'path';
import { ObsidianHttpAdapter } from "./http-adapter";
import { LibraryConfig, LibraryStatus, RegistryItem } from "../types";
import { DataService } from "../services/data-service";
import { NodeFsAdapter } from "./node-fs-adapter";
import { AbstractFolderPluginSettings } from "../../settings";
import { AuthService } from "../services/auth-service";

/**
 * LibraryManager handles Git operations using isomorphic-git.
 * It uses a physical Node FS adapter to sync files directly to the vault.
 */
export class LibraryManager {
    constructor(private app: App, private settings: AbstractFolderPluginSettings) {}

    /**
     * Fetch and cache GitHub user info.
     */
    async refreshIdentity(): Promise<{ login: string; avatar_url: string; name: string | null; email: string | null } | null> {
        const token = this.getToken();
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
            const absoluteDir = this.getAbsolutePath(vaultPath);
            const matrix = await git.statusMatrix({ fs: NodeFsAdapter, dir: absoluteDir });
            
            // row[1] = head, row[2] = workdir, row[3] = stage
            // unmodified: [1,1,1], modified: [1,2,1], staged: [1,2,2], added: [0,2,2], deleted: [1,0,0]
            const dirty = matrix.filter((row: any[]) => row[1] !== row[2] || row[2] !== row[3]).length;

            // Ahead count (commits not on remote)
            // This is a bit more complex with isomorphic-git, for now let's focus on dirty count
            // or use git.log comparing local and remote branches if possible.
            
            return { ahead: 0, dirty }; 
        } catch (e) {
            return { ahead: 0, dirty: 0 };
        }
    }

    private getToken(): string | undefined {
        return this.settings.librarySettings?.githubToken;
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
    async cloneLibrary(repositoryUrl: string, destinationPath: string, item?: RegistryItem, token?: string): Promise<void> {
        try {
            const absoluteDir = this.getAbsolutePath(destinationPath);
            
            console.debug(`[LibraryManager] Cloning library from ${repositoryUrl} to ${absoluteDir}`);

            const tokenToUse = token || this.getToken();
            
            /* eslint-disable @typescript-eslint/no-unsafe-assignment */
            await git.clone({
                fs: NodeFsAdapter,
                http: ObsidianHttpAdapter as any,
                dir: absoluteDir,
                url: repositoryUrl,
                onAuth: tokenToUse ? () => ({ username: tokenToUse }) : undefined,
                singleBranch: true,
                depth: 1
            });
            /* eslint-enable @typescript-eslint/no-unsafe-assignment */

            console.debug(`[LibraryManager] Clone complete for ${absoluteDir}. Verifying contents...`);
            try {
                const configPath = path.join(absoluteDir, 'library.config.json');
                const configExists = await NodeFsAdapter.promises.stat(configPath).catch(() => null);

                if (!configExists) {
                    if (item) {
                        console.debug(`[LibraryManager] library.config.json missing in ${absoluteDir}. Bootstrapping from Registry metadata...`);
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
                        throw new Error("Library is missing library.config.json and no metadata was provided for bootstrapping.");
                    }
                }
            } catch (e) {
                console.error(`[LibraryManager] Post-clone verification/bootstrapping failed for ${absoluteDir}:`, e);
                throw e; // Re-throw to ensure the UI knows installation failed
            }

            // Refresh the vault so Obsidian sees the new files
            await this.app.vault.adapter.list(destinationPath);
            
            new Notice(`Library installed: ${destinationPath}`);
        } catch (error) {
            console.error("Clone failed", error);
            throw error;
        }
    }

    /**
     * Pull updates for an existing library.
     */
    async updateLibrary(vaultPath: string, token?: string): Promise<void> {
        try {
            const absoluteDir = this.getAbsolutePath(vaultPath);
            const tokenToUse = token || this.getToken();

            const gitSettings = this.settings.librarySettings;
            const author = {
                name: gitSettings.gitName || gitSettings.githubUsername || "Abstract Library Manager",
                email: gitSettings.gitEmail || (gitSettings.githubUsername ? `${gitSettings.githubUsername}@users.noreply.github.com` : "manager@abstract.library")
            };

            /* eslint-disable @typescript-eslint/no-unsafe-assignment */
            await git.pull({
                fs: NodeFsAdapter,
                http: ObsidianHttpAdapter as any,
                dir: absoluteDir,
                onAuth: tokenToUse ? () => ({ username: tokenToUse }) : undefined,
                singleBranch: true,
                author: author,
                committer: author
            });
            /* eslint-enable @typescript-eslint/no-unsafe-assignment */

            // Refresh vault
            await this.app.vault.adapter.list(vaultPath);

            new Notice("Library updated successfully");
        } catch (error) {
            console.error("Update failed", error);
            throw error;
        }
    }

    /**
     * Check the status of the library.
     */
    async getStatus(vaultPath: string): Promise<LibraryStatus> {
        try {
            const absoluteDir = this.getAbsolutePath(vaultPath);
            /* eslint-disable @typescript-eslint/no-unsafe-assignment */
            const matrix = await git.statusMatrix({
                fs: NodeFsAdapter,
                dir: absoluteDir
            });
            /* eslint-enable @typescript-eslint/no-unsafe-assignment */
            
            // row[1] = head, row[2] = workdir, row[3] = stage
            // 0: absent, 1: unmodified, 2: modified
            const isDirty = matrix.some((row: any[]) => row[1] !== row[2] || row[2] !== row[3]);
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
        try {
            const absoluteDir = this.getAbsolutePath(vaultPath);
            const configPath = path.join(absoluteDir, 'library.config.json');
            const configContent = await NodeFsAdapter.promises.readFile(configPath, "utf8");
            return DataService.parseLibraryConfig(configContent);
        } catch (error) {
            console.error("Validation failed", error);
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
    async isLibraryOwner(vaultPath: string): Promise<{ isOwner: boolean; author: string }> {
        try {
            const config = await this.validateLibrary(vaultPath);
            const author = config.author || "Unknown";
            
            const username = this.settings.librarySettings.githubUsername;
            const gitName = this.settings.librarySettings.gitName;
            
            // 1. Check Author Name (Display/Legacy)
            const nameMatch = (username?.toLowerCase() === author.toLowerCase()) || 
                             (gitName?.toLowerCase() === author.toLowerCase());
            
            // 2. Check Actual Git Remote (Most robust)
            const actualRemote = await this.getRemoteUrl(vaultPath);
            const manifestRemote = config.repositoryUrl;
            
            let repoMatch = false;
            const checkUrl = actualRemote || manifestRemote;
            if (username && checkUrl) {
                const lowerRepo = checkUrl.toLowerCase();
                const lowerUser = username.toLowerCase();
                repoMatch = lowerRepo.includes(`github.com/${lowerUser}/`) || 
                           lowerRepo.includes(`github.com:${lowerUser}/`);
            }

            return { isOwner: nameMatch || repoMatch, author };
        } catch (error) {
            console.error("[LibraryManager] Failed to determine library ownership", error);
            return { isOwner: false, author: "Unknown" };
        }
    }

    /**
     * Get the remote URL for the library.
     */
    async getRemoteUrl(vaultPath: string): Promise<string | null> {
        try {
            const absoluteDir = this.getAbsolutePath(vaultPath);
            const url = await git.getConfig({
                fs: NodeFsAdapter,
                dir: absoluteDir,
                path: 'remote.origin.url'
            });
            return url as string;
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
     * Ensure a .gitignore exists with standard exclusions.
     */
    private async ensureGitIgnore(absoluteDir: string): Promise<void> {
        const gitIgnorePath = path.join(absoluteDir, '.gitignore');
        const librariesPath = this.settings.librarySettings?.librariesPath || "Abstract Library";
        const defaultExclusions = [
            `${librariesPath}/`,
            '.obsidian/',
            '.trash/',
            'node_modules/',
            '*.log'
        ].join('\n');

        try {
            const exists = await NodeFsAdapter.promises.stat(gitIgnorePath).catch(() => null);
            if (!exists) {
                await NodeFsAdapter.promises.writeFile(gitIgnorePath, defaultExclusions, 'utf8');
                console.debug(`[LibraryManager] Created default .gitignore at ${gitIgnorePath}`);
            } else {
                // Optionally append exclusions if missing, but let's keep it simple for now
                console.debug(`[LibraryManager] Existing .gitignore found at ${gitIgnorePath}`);
            }
        } catch (error) {
            console.error("Failed to ensure .gitignore", error);
        }
    }

    /**
     * Recursively scan for files larger than a threshold (default 10MB).
     */
    public async checkForLargeFiles(vaultPath: string, thresholdMB: number = 10): Promise<string[]> {
        const largeFiles: string[] = [];
        const thresholdBytes = thresholdMB * 1024 * 1024;
        const absoluteDir = this.getAbsolutePath(vaultPath);

        const librariesPath = this.settings.librarySettings?.librariesPath || "Abstract Library";
        const scan = async (dir: string) => {
            const entries = await NodeFsAdapter.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === librariesPath) continue;
                    await scan(fullPath);
                } else if (entry.isFile()) {
                    const stats = await NodeFsAdapter.promises.stat(fullPath);
                    if (stats.size > thresholdBytes) {
                        largeFiles.push(path.relative(absoluteDir, fullPath));
                    }
                }
            }
        };

        try {
            await scan(absoluteDir);
        } catch (e) {
            console.error("Scanning for large files failed", e);
        }
        return largeFiles;
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
            const tokenToUse = token || this.getToken();

            // 2. Initial safety checks
            await this.ensureGitIgnore(absoluteDir);
            const largeFiles = await this.checkForLargeFiles(vaultPath);
            if (largeFiles.length > 0) {
                const message = `Warning: ${largeFiles.length} files are larger than 10MB. This may cause sync issues.`;
                new Notice(message);
                console.warn(message, largeFiles);
            }

            // 3. git init
            await git.init({ fs: NodeFsAdapter, dir: absoluteDir });

            // add remote
            await git.addRemote({
                fs: NodeFsAdapter,
                dir: absoluteDir,
                remote: 'origin',
                url: repositoryUrl
            });

            // Initial commit and push
            await this.syncBackup(vaultPath, "Initial backup via Abstract Folder", tokenToUse);
            
            new Notice(`Backup initialized for ${vaultPath}`);
        } catch (error) {
            console.error("Backup initialization failed", error);
            throw error;
        }
    }

    /**
     * Sync changes to the remote (pull, add, commit, push).
     */
    async syncBackup(vaultPath: string, message: string = "Sync via Abstract Folder", token?: string, silent: boolean = false): Promise<void> {
        try {
            const absoluteDir = this.getAbsolutePath(vaultPath);
            const tokenToUse = token || this.getToken();
            
            const gitSettings = this.settings.librarySettings;
            const author = { 
                name: gitSettings.gitName || gitSettings.githubUsername || "Abstract Folder", 
                email: gitSettings.gitEmail || (gitSettings.githubUsername ? `${gitSettings.githubUsername}@users.noreply.github.com` : "backup@abstract.folder")
            };

            // 1. Pull changes
            try {
                await git.pull({
                    fs: NodeFsAdapter,
                    http: ObsidianHttpAdapter as any,
                    dir: absoluteDir,
                    onAuth: tokenToUse ? () => ({ username: tokenToUse }) : undefined,
                    singleBranch: true,
                    author: author,
                    committer: author
                });
            } catch (e) {
                console.warn("Pull failed (could be initial push)", e);
            }

            // 2. Add all files
            await git.add({ fs: NodeFsAdapter, dir: absoluteDir, filepath: "." });

            // 3. Commit
            await git.commit({
                fs: NodeFsAdapter,
                dir: absoluteDir,
                message: message,
                author: author,
                committer: author
            });

            // 4. Push
            await git.push({
                fs: NodeFsAdapter,
                http: ObsidianHttpAdapter as any,
                dir: absoluteDir,
                onAuth: tokenToUse ? () => ({ username: tokenToUse }) : undefined,
                remote: 'origin'
            });

            if (!silent) new Notice("Backup synced successfully");
        } catch (error) {
            console.error("Sync failed", error);
            throw error;
        }
    }
}
