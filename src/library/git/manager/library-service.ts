import { App, Notice } from "obsidian";
import * as path from 'path';
import { GitService } from "./git-service";
import { StatusManager } from "./status-manager";
import { AbstractFolderPluginSettings } from "../../../settings";
import { LibraryConfig, LibraryStatus, CatalogItem } from "../../types";
import { NodeFsAdapter } from "../node-fs-adapter";
import { DataService } from "../../services/data-service";
import { ConflictManager } from "../conflict-manager";
import { MergeModal } from "../../../ui/modals/merge/merge-modal";
import { ConflictResolutionModal } from "../../../ui/modals/conflict-resolution-modal";
import { Logger } from "../../../utils/logger";
import { GitScopeManager } from "../git-scope-manager";

/**
 * LibraryService handles operations specific to libraries,
 * which contain a library.json configuration file.
 */
export class LibraryService {
    private isConflictModalOpen = false;

    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private gitService: GitService,
        private statusManager: StatusManager,
        private scopeManager: GitScopeManager
    ) {}

    /**
     * Clone a library into the vault.
     */
    async cloneLibrary(repositoryUrl: string, destinationPath: string, item?: CatalogItem, token?: string): Promise<void> {
        try {
            const absoluteDir = this.gitService.getAbsolutePath(destinationPath);

            // Ensure the directory exists before cloning into it with '.'
            await NodeFsAdapter.promises.mkdir(absoluteDir, { recursive: true });

            const engine = await this.gitService.getEngine();
            const tokenToUse = token || await this.gitService.ensureToken(destinationPath, () => this.statusManager.clearFetchingLock(destinationPath));
            await engine.clone(absoluteDir, repositoryUrl, tokenToUse);

            console.debug(`[LibraryService] Clone complete for ${absoluteDir}. Verifying contents...`);
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
                        console.debug(`[LibraryService] Created bootstrap manifest at ${configPath}`);
                    } else {
                        throw new Error("Library is missing library.json and no metadata was provided for bootstrapping.");
                    }
                }
            } catch (e) {
                console.error(`[LibraryService] Post-clone verification/bootstrapping failed for ${absoluteDir}:`, e);
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
     * Pull updates for an existing library.
     */
    async updateLibrary(vaultPath: string, token?: string): Promise<void> {
        try {
            const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
            const engine = await this.gitService.getEngine();
            const tokenToUse = token || await this.gitService.ensureToken(vaultPath, () => this.statusManager.clearFetchingLock(vaultPath));

            const author = this.gitService.getSyncAuthor();
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
                            const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
                            const engine = await this.gitService.getEngine();
                            const tokenToUse = token || await this.gitService.ensureToken(vaultPath);
                            const author = this.gitService.getSyncAuthor();

                            new Notice("Overwriting local changes and pulling...");
                            await engine.discardChanges(absoluteDir, files);

                            // Single retry
                            await engine.pull(absoluteDir, "main", author, tokenToUse);

                            // Invalidate bridge + graph cache so the file tree reflects new state
                            const bridge = (this.app as any).plugins?.plugins?.['abstract-folder']?.abstractBridge;
                            if (bridge) bridge.invalidateCache();

                            await this.app.vault.adapter.list(vaultPath);
                            (this.app.workspace as any).trigger('abstract-folder:spaces-updated');

                            new Notice("Library updated successfully");
                        } catch (e: any) {
                            new Notice(`Resolution failed: ${e.message}`);
                            Logger.error("[LibraryService] Post-conflict pull failed", e);
                        }
                    }
                }).open();
                return;
            }

            if (error.code === 'MergeConflictError' || error.name === 'MergeConflictError') {
                const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
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
            const matrix = await this.statusManager.getFileStatuses(vaultPath);
            
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
        const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
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
            const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
            
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
     */
    async isLibraryOwner(vaultPath: string): Promise<{ isOwner: boolean; author: string; repositoryUrl: string | null }> {
        try {
            const config = await this.validateLibrary(vaultPath).catch(() => null);
            const author = config?.author || "Unknown";
            
            const username = this.settings.librarySettings.githubUsername;
            const gitName = this.settings.librarySettings.gitName;
            
            const nameMatch = config ? ((username?.toLowerCase() === author.toLowerCase()) || 
                             (gitName?.toLowerCase() === author.toLowerCase())) : false;
            
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

            const spacesRoot = this.settings.librarySettings.sharedSpacesRoot || "Abstract Spaces";
            const isLocalOnlySpace = vaultPath.startsWith(spacesRoot) && !actualRemote;

            return { isOwner: nameMatch || repoMatch || isLocalOnlySpace, author, repositoryUrl: checkUrl ?? null };
        } catch (error) {
            console.error("[LibraryService] Failed to determine library ownership", error);
            return { isOwner: false, author: "Unknown", repositoryUrl: null };
        }
    }

    /**
     * Get the remote URL for the library.
     */
    async getRemoteUrl(vaultPath: string): Promise<string | null> {
        try {
            const absoluteDir = this.gitService.getAbsolutePath(vaultPath);
            const engine = await this.gitService.getEngine();
            const url = await engine.getConfig(absoluteDir, 'remote.origin.url');
            return url || null;
        } catch (error) {
            return null;
        }
    }
}
