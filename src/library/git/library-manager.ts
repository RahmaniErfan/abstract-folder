import { App, Notice } from "obsidian";
import * as git from "isomorphic-git";
import { ObsidianHttpAdapter } from "./http-adapter";
import { LibraryConfig, LibraryStatus } from "../types";
import { DataService } from "../services/data-service";

/**
 * LibraryManager handles Git operations using isomorphic-git.
 * It expects a lightning-fs instance to interact with the virtual file system.
 */
export class LibraryManager {
    constructor(private app: App, private fs: any) {}

    /**
     * Clone a library into the vault.
     */
    async cloneLibrary(repositoryUrl: string, destinationPath: string, token?: string): Promise<void> {
        try {
            await git.clone({
                fs: this.fs,
                http: ObsidianHttpAdapter,
                dir: destinationPath,
                url: repositoryUrl,
                onAuth: () => ({ username: token || "" }),
                singleBranch: true,
                depth: 1
            });

            new Notice(`Library cloned successfully to ${destinationPath}`);
        } catch (error) {
            console.error("Clone failed", error);
            throw error;
        }
    }

    /**
     * Pull updates for an existing library.
     */
    async updateLibrary(path: string, token?: string): Promise<void> {
        try {
            await git.pull({
                fs: this.fs,
                http: ObsidianHttpAdapter,
                dir: path,
                onAuth: () => ({ username: token || "" }),
                singleBranch: true,
                author: {
                    name: "Abstract Library Manager",
                    email: "manager@abstract.library"
                }
            });
            new Notice("Library updated successfully");
        } catch (error) {
            console.error("Update failed", error);
            throw error;
        }
    }

    /**
     * Check the status of the library.
     */
    async getStatus(path: string): Promise<LibraryStatus> {
        try {
            const matrix = await git.statusMatrix({
                fs: this.fs,
                dir: path
            });
            
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
    async validateLibrary(path: string): Promise<LibraryConfig> {
        try {
            const configContent = await this.fs.promises.readFile(`${path}/library.config.json`, "utf8");
            return DataService.parseLibraryConfig(configContent as string);
        } catch (error) {
            console.error("Validation failed", error);
            throw new Error(`Failed to validate library at ${path}: ${error.message}`);
        }
    }
}
