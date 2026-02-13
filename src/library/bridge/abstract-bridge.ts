import { App, TFolder, TFile } from "obsidian";
import { LibraryNode, LibraryConfig } from "../types";
import { FolderNode } from "../../types";

/**
 * AbstractBridge is responsible for merging virtual library nodes 
 * into the plugin's file tree.
 */
export class AbstractBridge {
    constructor(private app: App) {}

    /**
     * Finds all library folders in the vault and converts them to LibraryNodes.
     */
    async discoverLibraries(basePath: string): Promise<LibraryNode[]> {
        const libraryRoot = this.app.vault.getAbstractFileByPath(basePath);
        if (!(libraryRoot instanceof TFolder)) return [];

        const libraries: LibraryNode[] = [];
        
        for (const child of libraryRoot.children) {
            if (child instanceof TFolder) {
                const configNode = child.children.find(f => f instanceof TFile && f.name === "library.config.json") as TFile;
                if (configNode) {
                    try {
                        const content = await this.app.vault.read(configNode);
                        const config = JSON.parse(content) as LibraryConfig;
                        
                        libraries.push({
                            file: null, // Virtualized
                            path: child.path,
                            isFolder: true,
                            isLibrary: true,
                            libraryId: config.id,
                            registryId: "default", // Placeholder
                            isPublic: true,
                            status: 'up-to-date',
                            isLocked: true,
                            children: this.mapFolderToNodes(child)
                        });
                    } catch (e) {
                        console.error(`Failed to load library config at ${child.path}`, e);
                    }
                }
            }
        }
        
        return libraries;
    }

    /**
     * Recursively maps a TFolder to a list of nodes (FolderNode or LibraryNode).
     */
    private mapFolderToNodes(folder: TFolder): (FolderNode | LibraryNode)[] {
        return folder.children.map(child => {
            const node: FolderNode = {
                file: child instanceof TFile ? child : null,
                path: child.path,
                isFolder: child instanceof TFolder,
                children: child instanceof TFolder ? this.mapFolderToNodes(child) : []
            };
            return node;
        });
    }

    /**
     * Injects libraries into the main tree structure.
     */
    injectLibraries(tree: FolderNode[], libraries: LibraryNode[]): FolderNode[] {
        // This is where we hook into the VirtualTreeManager's render logic
        // We add the libraries as top-level roots or under a specific group
        return [...tree, ...libraries];
    }
}
