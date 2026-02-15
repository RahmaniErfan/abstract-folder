import { App } from "obsidian";
import { ResourceURI, URIUtils } from "./uri";
import { ITreeProvider, TreeNode } from "./tree-provider";
import { ContextEngine } from "./context-engine";
import { Logger } from "../utils/logger";
import { createSortComparator } from "../utils/sorting";
import { MetricsManager } from "../metrics-manager";
import { AbstractFolderPluginSettings } from "../settings";
import { FolderNode } from "../types";

/**
 * TreeCoordinator aggregates multiple ITreeProviders and manages
 * the unified hierarchical model for the view.
 */
export class TreeCoordinator {
    private providers: Map<string, ITreeProvider> = new Map();
    private activeProviderIds: Set<string> | null = null;

    constructor(
        private app: App,
        private contextEngine: ContextEngine,
        private settings: AbstractFolderPluginSettings,
        private metricsManager: MetricsManager
    ) {
        // Subscribe to context changes to update providers (e.g., active group)
        this.contextEngine.subscribe((state) => {
            this.providers.forEach(provider => {
                if (provider.id === 'local') {
                    // Type-safe way to call setActiveGroup on LocalVaultProvider
                    const localProvider = provider as { setActiveGroup?: (id: string | null) => void };
                    if (localProvider.setActiveGroup) {
                        localProvider.setActiveGroup(state.activeGroup);
                    }
                }
            });
        });
    }

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
        
        // Apply sorting
        const state = this.contextEngine.getState();
        const sortComparator = createSortComparator(
            this.app,
            this.settings,
            state.sortConfig.sortBy,
            state.sortConfig.sortOrder,
            this.metricsManager
        );
        
        // Adapt sortComparator (FolderNode -> TreeNode)
        roots.sort((a, b) => {
            const folderA = this.adaptToFolderNode(a);
            const folderB = this.adaptToFolderNode(b);
            return sortComparator(folderA, folderB);
        });
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
        
        // Apply sorting
        const state = this.contextEngine.getState();
        const sortComparator = createSortComparator(
            this.app,
            this.settings,
            state.sortConfig.sortBy,
            state.sortConfig.sortOrder,
            this.metricsManager
        );
        
        // Adapt sortComparator (FolderNode -> TreeNode)
        children.sort((a, b) => {
            const folderA = this.adaptToFolderNode(a);
            const folderB = this.adaptToFolderNode(b);
            return sortComparator(folderA, folderB);
        });
        return children;
    }

    /**
     * Adapts a TreeNode to a FolderNode for the legacy sort comparator.
     */
    private adaptToFolderNode(node: TreeNode): FolderNode {
        const file = (node as unknown as Record<string, unknown>).file;
        return {
            path: node.uri.path,
            isFolder: node.isFolder,
            file: file,
            isLibrary: node.uri.provider !== "local",
            children: []
        } as unknown as FolderNode;
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
        const searchQuery = state.searchQuery?.toLowerCase() || "";

        const excludeExtensions = state.activeGroup
            ? this.settings.groups.find(g => g.id === state.activeGroup)?.filter?.excludeExtensions || []
            : this.settings.defaultFilter?.excludeExtensions || [];

        Logger.debug(`TreeCoordinator: Flattening tree. Roots count: ${roots.length}. Search query: "${searchQuery}". Exclusions: ${excludeExtensions.join(",")}`);
        
        // Use a set to track visited URIs to prevent infinite recursion in case of cycles
        const visited = new Set<string>();

        const traverse = async (node: TreeNode, depth: number) => {
            const serializedUri = URIUtils.toString(node.uri);
            const uriPath = node.uri.path;
            
            if (visited.has(serializedUri)) {
                Logger.warn(`TreeCoordinator: Cycle detected or redundant node at ${serializedUri}`);
                return;
            }

            // Check if extension is excluded
            if (!node.isFolder) {
                const extMatch = uriPath.match(/\.([^.]+)$/);
                const ext = extMatch ? extMatch[1].toLowerCase() : "";
                if (ext && excludeExtensions.includes(ext)) {
                    return;
                }
            }

            visited.add(serializedUri);

            const isMatch = !searchQuery || node.name.toLowerCase().includes(searchQuery);
            
            // If searching, we show matches regardless of parent expansion.
            // If not searching, we follow expansion rules.
            if (isMatch || searchQuery) {
                node.depth = depth;
                if (!searchQuery || isMatch) {
                    flatItems.push(node);
                }
            }

            // Check expansion against BOTH serialized URI and just the path
            const isExpanded = state.expandedURIs.has(serializedUri) || state.expandedURIs.has(uriPath);
            
            // If searching, we effectively "expand" everything to find matches in children
            if (node.isFolder && (isExpanded || searchQuery)) {
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
