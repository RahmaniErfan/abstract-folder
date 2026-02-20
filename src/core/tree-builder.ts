import { App } from "obsidian";
import { FileID, IGraphEngine } from "./graph-engine";
import { ContextEngine } from "./context-engine";
import { TreePipeline, StandardTreePipeline } from "./tree-pipeline";
import { Logger } from "../utils/logger";
import { ContentProvider } from "./content-provider";
import { MetricsManager } from "../metrics-manager";

export interface AbstractNode {
    /** The Physical Path (Obsidian Path) */
    id: FileID;
    /** The Synthetic Path (UI Unique Identity) */
    uri: string;
    name: string;
    level: number;
    isExpanded: boolean;
    isSelected: boolean;
    isFocused: boolean;
    hasChildren: boolean;
    extension?: string;
    icon?: string;
    isLibrary?: boolean;
    isShared?: boolean;
    isBackup?: boolean;
    syncStatus?: 'synced' | 'modified' | 'conflict' | 'untracked';
}

export interface TreeSnapshot {
    items: AbstractNode[];
    /** Map of Physical Path (FileID) to a list of Synthetic URIs where it appears */
    locationMap: Map<FileID, string[]>;
}

export interface TreeBuildOptions {
    filterQuery?: string | null;
    forceExpandAll?: boolean;
    showAncestors?: boolean;
    showDescendants?: boolean;
}

export class TreeBuilder {
    constructor(private app: App, private graph: IGraphEngine, private metricsManager: MetricsManager) {}

    /**
     * Builds a flattened tree view using a Depth-First Search (DFS) traversal.
     * Delegates filtering and sorting logic to a TreePipeline.
     */
    async *buildTree(
        context: ContextEngine, 
        provider: ContentProvider,
        options: TreeBuildOptions = {}
    ): AsyncGenerator<void, TreeSnapshot, void> {
        const items: AbstractNode[] = [];
        const locationMap = new Map<FileID, string[]>();
        const state = context.getState();
        
        const filterQuery = options.filterQuery;
        const forceExpandAll = options.forceExpandAll || false;

        const stateStr = JSON.stringify({ scope: provider.resolveScope(), filterQuery, forceExpandAll });
        // Logger.debug(`TreeBuilder: buildTree started with state: ${stateStr}`);

        // Determine active filter configuration
        let activeFilterConfig = context.settings.defaultFilter;
        if (provider.supportsGroups() && state.activeGroupId) {
            const group = context.settings.groups.find(g => g.id === state.activeGroupId);
            if (group && group.filter) {
                activeFilterConfig = group.filter;
            }
        }

        // 2. Resolve Roots via Provider
        let roots = provider.getRoots(this.graph);

        const isSearching = !!(filterQuery && filterQuery.trim().length > 0);
        const searchShowAncestors = options.showAncestors ?? context.settings.searchShowAncestors;
        const searchShowDescendants = options.showDescendants ?? context.settings.searchShowDescendants;

        // 3. Initialize Pipeline
        const pipeline: TreePipeline = new StandardTreePipeline(this.app, this.graph, this.metricsManager, {
            sortConfig: state.sortConfig,
            filterQuery: filterQuery || state.activeFilter,
            groupRoots: new Set(), 
            excludeExtensions: activeFilterConfig.excludeExtensions,
            searchShowDescendants: searchShowDescendants,
            searchShowAncestors: searchShowAncestors
        });

        // 4. Structural Root Resolution
        const structuralRoots = new Set(roots); 
        
        if (isSearching && !searchShowAncestors) {
            const query = (filterQuery || state.activeFilter)!.toLowerCase();
            const matchingNodes: FileID[] = [];
            
            // We iterate over ONLY files in the vault that are within the scoped path if a path-based scope is active.
            const allFiles = this.app.vault.getFiles();
            for (const file of allFiles) {
                
                // Scoped search logic: Filter files based on provider's scope
                let isInScope = false;
                if (provider.resolveScope() !== 'global') {
                      const scopeRoot = provider.getCreationRoot();
                      if (scopeRoot && (file.path === scopeRoot || file.path.startsWith(scopeRoot + '/'))) {
                          isInScope = true;
                      }
                } else if (state.activeGroupId) {
                    const group = context.settings.groups.find(g => g.id === state.activeGroupId);
                    if (group) {
                        if (group.parentFolders.some(folder => file.path.startsWith(folder))) {
                            isInScope = true;
                        }
                        else if (structuralRoots.size > 0 && this.isDescendantOf(file.path, structuralRoots)) {
                            isInScope = true;
                        }
                    }
                } else {
                     const libraryPath = context.settings.librarySettings.librariesPath;
                     const sharedSpacesRoot = context.settings.librarySettings.sharedSpacesRoot || "Abstract Spaces";
                     
                     let isExcluded = false;
                     if (libraryPath && (file.path === libraryPath || file.path.startsWith(libraryPath + '/'))) isExcluded = true;
                     if (sharedSpacesRoot && (file.path === sharedSpacesRoot || file.path.startsWith(sharedSpacesRoot + '/'))) isExcluded = true;
                     
                     if (!isExcluded) isInScope = true;
                }

                if (!isInScope) continue;

                if (file.name.toLowerCase().includes(query)) {
                    matchingNodes.push(file.path);
                }
            }
            roots = matchingNodes;

            // Prevent duplicate entries in search results
            if (searchShowDescendants) {
                const matchingSet = new Set(matchingNodes);
                roots = matchingNodes.filter(id => !this.isDescendantOf(id, matchingSet));
            }
        }
        
        // Update pipeline with resolved roots
        (pipeline as StandardTreePipeline).updateGroupRoots(new Set(roots));

        // 5. Root node exclusion check
        const filteredRoots = roots.filter(id => {
            const meta = this.graph.getNodeMeta?.(id);
            if (pipeline.isExcluded(id, meta)) return false;
            if (pipeline.isStructural(id)) return true;
            return pipeline.matches(id, meta);
        });


        const sortedRoots = pipeline.sort(filteredRoots);

        // 4. Fetch Sync Statuses
        const statusStartTime = performance.now();
        const scopedPath = provider.resolveScope() !== 'global' ? provider.getCreationRoot() : "";
        let syncStatusMap: Map<string, any> | null = null;
        if (scopedPath !== undefined) {
            try {
                syncStatusMap = await (this.app as any).plugins.plugins['abstract-folder'].libraryManager.getFileStatuses(scopedPath || "");
            } catch (e) {
                console.error("[TreeBuilder] Failed to fetch sync statuses", e);
            }
        }
        const statusEndTime = performance.now();
        // Logger.debug(`TreeBuilder: getFileStatuses took ${(statusEndTime - statusStartTime).toFixed(2)}ms`);

        const renderStartTime = performance.now();
        
        // Use a reverse stack for DFS processing
        const stack: Array<{ id: FileID, uri: string, level: number, visitedPath: Set<FileID>, parentId?: FileID }> = [];
        for (let i = sortedRoots.length - 1; i >= 0; i--) {
            const r = sortedRoots[i];
            stack.push({
                id: r,
                uri: r,
                level: 0,
                visitedPath: new Set([r]),
                parentId: undefined 
            });
        }

        let yieldCounter = 0;

        while (stack.length > 0) {
            const { id, uri, level, visitedPath, parentId } = stack.pop()!;
            
            const meta = this.graph.getNodeMeta?.(id);
            const rawChildren = this.graph.getChildren(id);
            
            const isExpanded = forceExpandAll || context.isExpanded(uri);
            
            // Phase 1: Hard Exclusion (Filter by extension/settings)
            if (pipeline.isExcluded(id, meta)) continue;

            // [STRICT SCOPE CHECK] - Re-verify for children to ensure no leaks
            // (Strictly speaking, children of in-scope nodes should be in-scope, but links/shortcuts might bridge out)
            // For now, we assume graph integrity prevents leaks unless utilizing symlinks logic (not yet imp).

            // Phase 2: Structural Inclusion (Force show roots or groups)
            const isStructural = !isSearching && pipeline.isStructural(id);

            // Phase 3: Search Matching (Filter items by query)
            const isMatch = isSearching ? pipeline.matches(id, meta, parentId) : true;

            // Decision
            if (!isStructural && (isSearching && !isMatch)) continue;

            // Determine sync status
            let syncStatus: any = undefined;
            if (scopedPath !== "") {
                if (syncStatusMap && scopedPath !== undefined) {
                    const relativePath = (id === scopedPath ? "" : id.substring(scopedPath.length + 1));
                    syncStatus = syncStatusMap.get(relativePath);
                }
            } else {
                syncStatus = syncStatusMap ? syncStatusMap.get(id) : undefined;
            }

            items.push({
                id,
                uri,
                name: this.getNodeName(id),
                level,
                isExpanded,
                isSelected: context.isSelected(uri),
                isFocused: context.isFocused(uri),
                hasChildren: rawChildren.length > 0,
                extension: meta?.extension,
                icon: meta?.icon,
                isLibrary: meta?.isLibrary,
                isShared: meta?.isShared,
                isBackup: meta?.isBackup,
                syncStatus: syncStatus
            });
            
            // Track physical -> synthetic mapping
            const existing = locationMap.get(id) || [];
            existing.push(uri);
            locationMap.set(id, existing);

            // Recurse into children if the node is expanded or matches the search
            const shouldTraverseChildren = isExpanded || (isSearching && (searchShowDescendants || isMatch));

            if (shouldTraverseChildren) {
                const sortedChildren = pipeline.sort(rawChildren);
                for (let i = sortedChildren.length - 1; i >= 0; i--) {
                    const childId = sortedChildren[i];
                    if (!visitedPath.has(childId)) {
                        const childURI = `${uri}/${childId}`;
                        stack.push({
                            id: childId,
                            uri: childURI,
                            level: level + 1,
                            visitedPath: new Set([...visitedPath, childId]),
                            parentId: id 
                        });
                    }
                }
            }

            if (++yieldCounter % 50 === 0) {
                // Logger.debug(`[Abstract Folder] TreeBuilder: Processing... reached ${items.length} items`);
                yield;
            }
        }

        const renderEndTime = performance.now();
        // Logger.debug(`TreeBuilder: DFS Traversal took ${(renderEndTime - renderStartTime).toFixed(2)}ms`);
        // Logger.debug(`TreeBuilder: buildTree complete, total items: ${items.length}`);
        return { items, locationMap };
    }

    private getNodeName(path: string): string {
        return path.split('/').pop() || path;
    }

    private isDescendantOf(childId: FileID, distinctAncestors: Set<FileID>): boolean {
        // BFS upstream to see if we hit any of the ancestors
        const visited = new Set<FileID>();
        const queue = [childId];

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current)) continue;
            visited.add(current);

            const parents = this.graph.getParents(current);
            for (const parent of parents) {
                if (distinctAncestors.has(parent)) return true;
                queue.push(parent);
            }
        }
        return false;
    }
}
