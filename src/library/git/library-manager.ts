import { App, Notice, FileSystemAdapter } from "obsidian";
import * as git from "isomorphic-git";
import * as path from 'path';
import { ObsidianHttpAdapter } from "./http-adapter";
import { LibraryConfig, LibraryStatus, RegistryItem } from "../types";
import { NodeFsAdapter } from "./node-fs-adapter";
import { DataService } from "../services/data-service";
import { AbstractFolderPluginSettings } from "../../settings";

/**
 * LibraryManager handles Git operations using isomorphic-git.
 * It uses a physical Node FS adapter to sync files directly to the vault.
 */
export class LibraryManager {
    constructor(private app: App, private settings: AbstractFolderPluginSettings) {}

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

            /* eslint-disable @typescript-eslint/no-unsafe-assignment */
            await git.pull({
                fs: NodeFsAdapter,
                http: ObsidianHttpAdapter as any,
                dir: absoluteDir,
                onAuth: tokenToUse ? () => ({ username: tokenToUse }) : undefined,
                singleBranch: true,
                author: {
                    name: "Abstract Library Manager",
                    email: "manager@abstract.library"
                }
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
}
