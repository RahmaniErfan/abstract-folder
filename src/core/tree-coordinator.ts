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
    private activeProviderIds: Set<string> | null = null;

    constructor(private contextEngine: ContextEngine) {}

    /**
     * Registers a new data provider.
     */
    registerProvider(provider: ITreeProvider) {
        this.providers.set(provider.id, provider);
    }

    /**
     * Filters which providers are used for unified operations.
     * Pass null to use all registered providers.
     */
    setActiveProviders(providerIds: string[] | null) {
        this.activeProviderIds = providerIds ? new Set(providerIds) : null;
        Logger.debug(`TreeCoordinator: active providers set to ${providerIds ? providerIds.join(", ") : "all"}`);
    }

    private getEnabledProviders(): ITreeProvider[] {
        const all = Array.from(this.providers.values());
        if (!this.activeProviderIds) return all;
        return all.filter(p => this.activeProviderIds!.has(p.id));
    }

    /**
     * Gets roots from enabled providers.
     */
    async getUnifiedRoots(): Promise<TreeNode[]> {
        const enabled = this.getEnabledProviders();
        Logger.debug(`TreeCoordinator: getUnifiedRoots() called. Enabled: ${enabled.map(p => p.id).join(", ")}`);
        const allRoots: TreeNode[][] = await Promise.all(
            enabled.map(async p => {
                const roots = await p.getRoots();
                Logger.debug(`TreeCoordinator: Provider ${p.id} returned ${roots.length} roots.`);
                return roots;
            })
        );
        const roots = allRoots.flat();
        Logger.debug(`TreeCoordinator: Fetched ${roots.length} unified roots total.`);
        return roots;
    }

    /**
     * Resolves children for a given URI by delegating to the correct provider.
     */
    async getChildren(uri: ResourceURI): Promise<TreeNode[]> {
        const provider = this.providers.get(uri.provider);
        if (!provider) {
            Logger.error(`TreeCoordinator: No provider found for provider ID: ${uri.provider}`);
            return [];
        }
        const children = await provider.getChildren(uri);
        Logger.debug(`TreeCoordinator: Found ${children.length} children for path: ${uri.path}`);
        return children;
    }

    /**
     * Flattens the visible tree based on expansion state in ContextEngine.
     * This is the core logic for the VirtualViewport.
     */
    async getFlatVisibleItems(): Promise<TreeNode[]> {
        Logger.debug("TreeCoordinator: getFlatVisibleItems() started.");
        const state = this.contextEngine.getState();
        const roots = await this.getUnifiedRoots();
        const flatItems: TreeNode[] = [];

        Logger.debug(`TreeCoordinator: Flattening tree. Roots count: ${roots.length}. Expanded Set Size: ${state.expandedURIs.size}`);
        
        // Use a set to track visited URIs to prevent infinite recursion in case of cycles
        const visited = new Set<string>();

        const traverse = async (node: TreeNode, depth: number) => {
            const serializedUri = URIUtils.toString(node.uri);
            const uriPath = node.uri.path;
            
            if (visited.has(serializedUri)) {
                Logger.warn(`TreeCoordinator: Cycle detected or redundant node at ${serializedUri}`);
                return;
            }
            visited.add(serializedUri);

            node.depth = depth;
            flatItems.push(node);
            
            // Check expansion against BOTH serialized URI and just the path (for backward compatibility/migration)
            const isExpanded = state.expandedURIs.has(serializedUri) || state.expandedURIs.has(uriPath);
            
            if (node.isFolder && isExpanded) {
                Logger.debug(`TreeCoordinator: Recursing into expanded folder: ${uriPath} (${serializedUri})`);
                const children = await this.getChildren(node.uri);
                for (const child of children) {
                    await traverse(child, depth + 1);
                }
            }
        };

        for (const root of roots) {
            await traverse(root, 0);
        }

        Logger.debug(`TreeCoordinator: Flattening complete. Total flat items: ${flatItems.length}`);
        return flatItems;
    }
}
