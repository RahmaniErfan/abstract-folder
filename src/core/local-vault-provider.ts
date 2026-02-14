import { App, TFile } from "obsidian";
import { ITreeProvider, TreeNode } from "./tree-provider";
import { ResourceURI, URIUtils } from "./uri";
import { FolderIndexer } from "../indexer";

/**
 * LocalVaultProvider bridges the physical Obsidian vault and the SOVM architecture.
 */
export class LocalVaultProvider implements ITreeProvider {
    readonly id = 'local';

    constructor(private app: App, private indexer: FolderIndexer) {}

    async getRoots(): Promise<TreeNode[]> {
        const graph = this.indexer.getGraph();
        return Array.from(graph.roots).map(path => this.mapPathToNode(path));
    }

    async getChildren(parentUri: ResourceURI): Promise<TreeNode[]> {
        if (parentUri.provider !== this.id) return [];
        
        const graph = this.indexer.getGraph();
        const childrenPaths = graph.parentToChildren[parentUri.path];
        
        if (!childrenPaths) return [];
        return Array.from(childrenPaths).map(path => this.mapPathToNode(path));
    }

    async getMetadata(uri: ResourceURI): Promise<Record<string, unknown>> {
        const file = this.app.vault.getAbstractFileByPath(uri.path);
        if (file instanceof TFile) {
            const cache = this.app.metadataCache.getFileCache(file);
            return (cache?.frontmatter as Record<string, unknown>) || {};
        }
        return {};
    }

    async search(query: string): Promise<ResourceURI[]> {
        // This will eventually wrap the existing search logic from AbstractFolderView
        return [];
    }

    private mapPathToNode(path: string): TreeNode {
        const file = this.app.vault.getAbstractFileByPath(path);
        const name = file ? file.name : path.split('/').pop() || path;
        const isFolder = !!this.indexer.getGraph().parentToChildren[path];

        return {
            uri: URIUtils.local(path),
            name,
            isFolder,
            file: file instanceof TFile ? file : undefined
        };
    }
}
