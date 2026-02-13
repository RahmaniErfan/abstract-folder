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
    /* eslint-disable @typescript-eslint/no-explicit-any */
    constructor(private app: App, private fs: any) {}

    /**
     * Clone a library into the vault.
     */
    async cloneLibrary(repositoryUrl: string, destinationPath: string, token?: string): Promise<void> {
        try {
            // lightning-fs often requires paths to start with a leading slash
            const dir = destinationPath.startsWith('/') ? destinationPath : `/${destinationPath}`;
            
            console.debug(`Cloning library from ${repositoryUrl} to ${dir}`);

            /* eslint-disable @typescript-eslint/no-unsafe-assignment */
            await git.clone({
                fs: this.fs,
                http: ObsidianHttpAdapter as any,
                dir: dir,
                url: repositoryUrl,
                onAuth: token ? () => ({ username: token }) : undefined,
                singleBranch: true,
                depth: 1
            });
            /* eslint-enable @typescript-eslint/no-unsafe-assignment */

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
            const dir = path.startsWith('/') ? path : `/${path}`;
            /* eslint-disable @typescript-eslint/no-unsafe-assignment */
            await git.pull({
                fs: this.fs,
                http: ObsidianHttpAdapter as any,
                dir: dir,
                onAuth: token ? () => ({ username: token }) : undefined,
                singleBranch: true,
                author: {
                    name: "Abstract Library Manager",
                    email: "manager@abstract.library"
                }
            });
            /* eslint-enable @typescript-eslint/no-unsafe-assignment */
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
            const dir = path.startsWith('/') ? path : `/${path}`;
            /* eslint-disable @typescript-eslint/no-unsafe-assignment */
            const matrix = await git.statusMatrix({
                fs: this.fs,
                dir: dir
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
    async validateLibrary(path: string): Promise<LibraryConfig> {
        try {
            const dir = path.startsWith('/') ? path : `/${path}`;
            const configPath = dir.endsWith('/') ? `${dir}library.config.json` : `${dir}/library.config.json`;
            /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
            const configContent = await this.fs.promises.readFile(configPath, "utf8");
            /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
            return DataService.parseLibraryConfig(configContent as string);
        } catch (error) {
            console.error("Validation failed", error);
            /* eslint-disable @typescript-eslint/no-unsafe-member-access */
            throw new Error(`Failed to validate library at ${path}: ${error.message}`);
            /* eslint-enable @typescript-eslint/no-unsafe-member-access */
        }
    }
}
