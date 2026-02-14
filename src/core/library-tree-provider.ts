import { App, TFolder, TAbstractFile } from "obsidian";
import { ITreeProvider, TreeNode } from "./tree-provider";
import { ResourceURI } from "./uri";
import { AbstractBridge } from "../library/bridge/abstract-bridge";
import { AbstractFolderPluginSettings } from "../settings";
import { FolderNode } from "../types";

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

    async getRoots(): Promise<TreeNode[]> {
        const libraries = await this.bridge.discoverLibraries(this.settings.librarySettings.librariesPath);
        
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

    async getChildren(parentUri: ResourceURI): Promise<TreeNode[]> {
        if (parentUri.provider !== this.id) return [];

        const folder = this.app.vault.getAbstractFileByPath(parentUri.path);
        if (!(folder instanceof TFolder)) return [];

        const nodes: FolderNode[] = await this.bridge.buildAbstractLibraryTree(folder);
        
        return nodes.map(node => this.mapFolderNodeToTreeNode(node, parentUri.context));
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
