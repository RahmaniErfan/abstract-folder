import { ResourceURI, URIUtils } from "./uri";
import { ITreeProvider, TreeNode } from "./tree-provider";
import { ContextEngine } from "./context-engine";
import { Logger } from "../utils/logger";

/**
 * TreeCoordinator aggregates multiple ITreeProviders and manages 
 * the unified hierarchical model for the view.
 */
export class TreeCoordinator {
    private providers: Map<string, ITreeProvider> = new Map();

    constructor(private contextEngine: ContextEngine) {}

    /**
     * Registers a new data provider.
     */
    registerProvider(provider: ITreeProvider) {
        this.providers.set(provider.id, provider);
    }

    /**
     * Gets roots from all registered providers.
     */
    async getUnifiedRoots(): Promise<TreeNode[]> {
        const allRoots: TreeNode[][] = await Promise.all(
            Array.from(this.providers.values()).map(p => p.getRoots())
        );
        return allRoots.flat();
    }

    /**
     * Resolves children for a given URI by delegating to the correct provider.
     */
    async getChildren(uri: ResourceURI): Promise<TreeNode[]> {
        const provider = this.providers.get(uri.provider);
        if (!provider) {
            Logger.error(`TreeCoordinator: No provider found for ${uri.provider}`);
            return [];
        }
        return provider.getChildren(uri);
    }

    /**
     * Flattens the visible tree based on expansion state in ContextEngine.
     * This is the core logic for the VirtualViewport.
     */
    async getFlatVisibleItems(): Promise<TreeNode[]> {
        const state = this.contextEngine.getState();
        const roots = await this.getUnifiedRoots();
        const flatItems: TreeNode[] = [];

        const traverse = async (node: TreeNode) => {
            flatItems.push(node);
            const uriString = URIUtils.toString(node.uri);
            
            if (node.isFolder && state.expandedURIs.has(uriString)) {
                const children = await this.getChildren(node.uri);
                for (const child of children) {
                    await traverse(child);
                }
            }
        };

        for (const root of roots) {
            await traverse(root);
        }

        return flatItems;
    }
}
