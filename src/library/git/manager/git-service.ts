import { App, Notice, FileSystemAdapter, Platform } from "obsidian";
import * as path from 'path';
import { AbstractFolderPluginSettings } from "../../../settings";
import { AuthService } from "../../services/auth-service";
import { SecurityManager } from "../../../core/security-manager";
import { GitDesktopAdapter } from "../git-desktop-adapter";
import { GitMobileAdapter } from "../git-mobile-adapter";
import { IGitEngine, GitStatusMatrix } from "../types";
import { SyncAuthor } from "../sync/types";
import { Logger } from "../../../utils/logger";

/**
 * GitService handles core Git engine management, capability probes,
 * authentication, and basic path resolution.
 */
export class GitService {
    private gitDesktopAdapter: GitDesktopAdapter;
    private gitMobileAdapter: GitMobileAdapter;
    private hasNativeGit: boolean | undefined = undefined;

    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private securityManager: SecurityManager
    ) {
        this.gitDesktopAdapter = new GitDesktopAdapter();
        this.gitMobileAdapter = new GitMobileAdapter(this.securityManager);
    }

    async getEngine(): Promise<IGitEngine> {
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
                console.warn("[GitService] Native git not found, falling back to isomorphic-git", e);
                this.hasNativeGit = false;
            }
        } else {
            this.hasNativeGit = false;
        }
        return this.hasNativeGit ? this.gitDesktopAdapter : this.gitMobileAdapter;
    }

    async checkNativeGit(): Promise<boolean> {
        if (!Platform.isDesktop) return false;
        try {
            const { promisify } = require('util');
            const { execFile } = require('child_process');
            const execFileAsync = promisify(execFile);
            const augmentedPath = (process.env.PATH || '') + ':/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/git/bin';
            await execFileAsync('git', ['--version'], { env: { ...process.env, PATH: augmentedPath } });
            return true;
        } catch (e) {
            return false;
        }
    }

    async refreshIdentity(providedToken?: string): Promise<{ login: string; avatar_url: string; name: string | null; email: string | null } | null> {
        const token = providedToken || await this.getToken();
        if (!token) return null;

        const userInfo = await AuthService.getUserInfo(token);
        if (userInfo) {
            this.settings.librarySettings.githubUsername = userInfo.login;
            this.settings.librarySettings.githubAvatar = userInfo.avatar_url;
            
            const name = userInfo.name || userInfo.login;
            const email = userInfo.email || `${userInfo.login}@users.noreply.github.com`;
            
            this.settings.librarySettings.gitName = name;
            this.settings.librarySettings.gitEmail = email;
            
            try {
                const plugin = (this.app as any).plugins.getPlugin("abstract-folder");
                if (plugin) {
                    await plugin.saveSettings();
                } else {
                    console.error("[GitService] Could not find plugin instance to save settings.");
                }
            } catch (e) {
                console.error("[GitService] Failed to save settings during refreshIdentity:", e);
            }
        }
        return userInfo;
    }

    async getToken(): Promise<string | undefined> {
        if (this.app?.secretStorage && typeof this.app.secretStorage.getSecret === 'function') {
            try {
                return await this.app.secretStorage.getSecret('abstract-folder-github-pat') || undefined;
            } catch (e: any) {
                if (e instanceof TypeError && e.message.includes('this.app.getSecret is not a function')) {
                    try {
                        return await this.app.secretStorage.getSecret.call(this.app, 'abstract-folder-github-pat') || undefined;
                    } catch (e2) {
                        Logger.warn("[GitService] SecretStorage context fallback failed.", e2);
                    }
                } else {
                    Logger.warn("[GitService] Failed to get secret from SecretStorage (keychain may be unavailable)", e);
                }
            }
        }
        return this.settings?.librarySettings?.githubToken;
    }

    async ensureToken(vaultPath?: string, onFail?: () => void): Promise<string> {
        const token = await this.getToken();
        if (!token) {
            new Notice("🔒 GitHub PAT missing. Please configure it in the Abstract Folder settings to enable Git Sync.");
            if (onFail) onFail();
            throw new Error("MISSING_TOKEN");
        }
        return token;
    }

    getAbsolutePath(vaultPath: string): string {
        if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
            throw new Error("Vault is not on a physical filesystem");
        }
        return path.join(this.app.vault.adapter.getBasePath(), vaultPath);
    }

    async getAuthorCredentials(): Promise<SyncAuthor> {
        let name = this.settings.librarySettings.gitName;
        let email = this.settings.librarySettings.gitEmail;

        if (!name || !email) {
            const token = await this.getToken();
            if (token) {
                Logger.debug("[GitService] Author credentials missing. Attempting background refresh.");
                const userInfo = await this.refreshIdentity(token);
                if (userInfo) {
                    name = this.settings.librarySettings.gitName;
                    email = this.settings.librarySettings.gitEmail;
                }
            }
        }

        return {
            name: name || 'Abstract Folder',
            email: email || 'noreply@abstractfolder.dev',
        };
    }

    getSyncAuthor(): SyncAuthor {
        return {
            name: this.settings.librarySettings.gitName || 'Abstract Folder',
            email: this.settings.librarySettings.gitEmail || 'noreply@abstractfolder.dev',
        };
    }

    /**
     * Get the Git status for a directory, handling failover between Desktop and Mobile adapters.
     */
    async getStatusMatrix(absoluteDir: string, ignoredPaths?: string[]): Promise<GitStatusMatrix> {
        if (Platform.isDesktop) {
            try {
                const matrix = await this.gitDesktopAdapter.getStatusMatrix(absoluteDir, ignoredPaths);
                console.debug(`[GitService] Git status fetched via Desktop Adapter for ${absoluteDir}`);
                return matrix;
            } catch (e: any) {
                if (e.message === 'GIT_NOT_FOUND') {
                    console.warn(`[GitService] Native git not found for ${absoluteDir}, falling back to isomorphic-git Worker.`);
                    const matrix = await this.gitMobileAdapter.getStatusMatrix(absoluteDir, ignoredPaths);
                    console.debug(`[GitService] Git status fetched via Mobile (Worker) Adapter for ${absoluteDir}`);
                    return matrix;
                }
                throw e;
            }
        } else {
            const matrix = await this.gitMobileAdapter.getStatusMatrix(absoluteDir, ignoredPaths);
            console.debug(`[GitService] Git status fetched via Mobile (Worker) Adapter for ${absoluteDir}`);
            return matrix;
        }
    }
}
