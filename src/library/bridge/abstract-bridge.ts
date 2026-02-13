import { App, TFolder, TFile } from "obsidian";
import { LibraryNode, LibraryConfig } from "../types";
import { FolderNode } from "../../types";

/**
 * AbstractBridge is responsible for merging physical library nodes
 * (synced via Git) into the plugin's file tree.
 */
export class AbstractBridge {
    constructor(private app: App) {}

    /**
     * Finds all library folders in the vault and converts them to LibraryNodes.
     */
    async discoverLibraries(basePath: string): Promise<LibraryNode[]> {
        try {
            const folder = this.app.vault.getAbstractFileByPath(basePath);
            if (!(folder instanceof TFolder)) return [];

            const libraries: LibraryNode[] = [];
            
            // Check if the current folder is a library
            const config = await this.getLibraryConfig(folder.path);
            if (config) {
                libraries.push({
                    file: folder,
                    path: folder.path,
                    isFolder: true,
                    isLibrary: true,
                    libraryId: config.id,
                    registryId: "default",
                    isPublic: true,
                    status: 'up-to-date',
                    isLocked: true,
                    children: this.mapVaultFolderToNodes(folder)
                });
            } else {
                // Scan subfolders for libraries
                for (const child of folder.children) {
                    if (child instanceof TFolder) {
                        const subLibraries = await this.discoverLibraries(child.path);
                        libraries.push(...subLibraries);
                    }
                }
            }

            return libraries;
        } catch (error) {
            console.error("Failed to discover libraries", error);
            return [];
        }
    }

    /**
     * Helper to read library.config.json from the vault.
     */
    private async getLibraryConfig(dir: string): Promise<LibraryConfig | null> {
        const configPath = `${dir}/library.config.json`;
        const file = this.app.vault.getAbstractFileByPath(configPath);
        if (file instanceof TFile) {
            try {
                const content = await this.app.vault.read(file);
                return JSON.parse(content) as LibraryConfig;
            } catch (e) {
                console.warn(`Failed to parse library config at ${configPath}`, e);
            }
        }
        return null;
    }

    /**
     * Recursively maps a vault folder to a list of nodes.
     */
    private mapVaultFolderToNodes(folder: TFolder): FolderNode[] {
        const nodes: FolderNode[] = [];

        for (const child of folder.children) {
            if (child.name === ".git" || child.name === "node_modules" || child.name === "library.config.json") continue;
            
            const isFolder = child instanceof TFolder;
            const isMarkdown = child instanceof TFile && child.extension === 'md';

            if (!isFolder && !isMarkdown) continue;

            nodes.push({
                file: child,
                path: child.path,
                isFolder: isFolder,
                children: isFolder ? this.mapVaultFolderToNodes(child as TFolder) : []
            });
        }
        return nodes;
    }

    /**
     * Injects libraries into the main tree structure.
     */
    injectLibraries(tree: FolderNode[], libraries: LibraryNode[]): FolderNode[] {
        // This is where we hook into the VirtualTreeManager's render logic
        // We add the libraries as top-level roots or under a specific group
        
        // Ensure libraries are sorted or unique if needed
        const libraryPaths = new Set(libraries.map(l => l.path));
        const filteredTree = tree.filter(node => !libraryPaths.has(node.path));
        
        return [...filteredTree, ...libraries];
    }

    /**
     * Gets the relative path within a library for a given virtual path.
     */
    getRelativePath(fullPath: string, libraryPath: string): string {
        if (!fullPath.startsWith(libraryPath)) return fullPath;
        return fullPath.substring(libraryPath.length).replace(/^\/+/, '');
    }
}
