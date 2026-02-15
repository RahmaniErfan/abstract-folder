import { App, TFolder, TAbstractFile } from "obsidian";
import { ITreeProvider, TreeNode } from "./tree-provider";
import { ResourceURI } from "./uri";
import { AbstractBridge } from "../library/bridge/abstract-bridge";
import { AbstractFolderPluginSettings } from "../settings";
import { FolderNode } from "../types";
import { Logger } from "src/utils/logger";

/**
 * LibraryTreeProvider integrates remote/synced libraries into the SOVM tree.
 * It uses AbstractBridge to discover and map library files to abstract hierarchies.
 */
import { TreeContext } from "./tree-provider";

/**
 * LibraryTreeProvider integrates remote/synced libraries into the SOVM tree.
 * It uses AbstractBridge to discover and map library files to abstract hierarchies.
 */
export class LibraryTreeProvider implements ITreeProvider {
    readonly id = 'library';
    private bridge: AbstractBridge;

    constructor(
        private app: App, 
        private settings: AbstractFolderPluginSettings
    ) {
        this.bridge = new AbstractBridge(this.app, this.settings);
    }

    async getRoots(context: TreeContext): Promise<TreeNode[]> {
        // If we have a selected library, we can optimize by not scanning everything if cached
        let libraries = await this.bridge.discoverLibraries(this.settings.librarySettings.librariesPath);
        
        const selectedId = context.libraryId;
        if (selectedId) {
            libraries = libraries.filter(lib => lib.libraryId === selectedId);
            Logger.debug(`LibraryTreeProvider: Filtered to ${libraries.length} libraries based on scope ${selectedId}`);
        }

        // Map top-level LibraryNodes to TreeNodes
        return libraries.map(lib => ({
            uri: {
                protocol: 'abstract',
                provider: this.id,
                context: lib.libraryId,
                path: lib.path
            },
            name: (lib.file as TAbstractFile).name,
            isFolder: true,
            metadata: {
                isLibrary: true,
                status: lib.status,
                libraryId: lib.libraryId
            }
        }));
    }

    async getChildren(parentUri: ResourceURI, context: TreeContext): Promise<TreeNode[]> {
        if (parentUri.provider !== this.id) return [];

        const folder = this.app.vault.getAbstractFileByPath(parentUri.path);
        if (!(folder instanceof TFolder)) return [];

        const nodes: FolderNode[] = await this.bridge.buildAbstractLibraryTree(folder);
        
        return nodes.map(node => this.mapFolderNodeToTreeNode(node, parentUri.context));
    }

    invalidateCache() {
        this.bridge.invalidateCache();
    }

    async getMetadata(uri: ResourceURI): Promise<Record<string, unknown>> {
        return { isLibrary: true };
    }

    async search(query: string): Promise<ResourceURI[]> {
        return [];
    }

    private mapFolderNodeToTreeNode(node: FolderNode, context: string): TreeNode {
        const name = node.file ? node.file.name : node.path.split('/').pop() || node.path;
        return {
            uri: {
                protocol: 'abstract',
                provider: this.id,
                context: context,
                path: node.path
            },
            name: name,
            isFolder: node.children.length > 0 || node.isFolder,
            metadata: {
                isLibrary: true,
                folderNode: node
            }
        };
    }
}
