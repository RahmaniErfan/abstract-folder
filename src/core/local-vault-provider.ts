import { App, TFile } from "obsidian";
import { ITreeProvider, TreeNode } from "./tree-provider";
import { ResourceURI, URIUtils } from "./uri";
import { FolderIndexer } from "../indexer";
import { Logger } from "../utils/logger";

/**
 * LocalVaultProvider bridges the physical Obsidian vault and the SOVM architecture.
 */
export class LocalVaultProvider implements ITreeProvider {
    readonly id = 'local';

    constructor(private app: App, private indexer: FolderIndexer) {
        Logger.debug("LocalVaultProvider: Initialized.");
    }

    async getRoots(): Promise<TreeNode[]> {
        Logger.debug("LocalVaultProvider: getRoots() called.");
        if (!this.indexer.hasBuiltFirstGraph()) {
            Logger.debug("LocalVaultProvider: Indexer has not built first graph yet.");
            return [];
        }

        const graph = this.indexer.getGraph();
        
        if (!graph) {
            Logger.error("LocalVaultProvider: Graph is undefined!");
            return [];
        }

        const rootPaths = Array.from(graph.roots);
        Logger.debug(`LocalVaultProvider: Indexer graph.roots has ${rootPaths.length} items.`, rootPaths);

        const roots = rootPaths.map(path => this.mapPathToNode(path));
        Logger.debug(`LocalVaultProvider: Mapped ${roots.length} root nodes.`);
        return roots;
    }

    async getChildren(parentUri: ResourceURI): Promise<TreeNode[]> {
        Logger.debug(`LocalVaultProvider: getChildren() called for ${parentUri.path}`);
        if (parentUri.provider !== this.id) {
            Logger.debug(`LocalVaultProvider: Provider mismatch. Expected ${this.id}, got ${parentUri.provider}`);
            return [];
        }
        
        const graph = this.indexer.getGraph();
        const childrenPaths = graph.parentToChildren[parentUri.path];
        
        if (!childrenPaths) {
            Logger.debug(`LocalVaultProvider: No children found in graph.parentToChildren for ${parentUri.path}`);
            return [];
        }
        
        const children = Array.from(childrenPaths).map(path => this.mapPathToNode(path));
        Logger.debug(`LocalVaultProvider: Found ${children.length} children for ${parentUri.path}`);
        return children;
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
