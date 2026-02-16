import { App } from "obsidian";
import { FileID, IGraphEngine } from "./graph-engine";
import { ContextEngineV2 } from "./context-engine-v2";
import { TreePipeline, StandardTreePipeline } from "./tree-pipeline";
import { Logger } from "src/utils/logger";
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
}

export interface TreeSnapshot {
    items: AbstractNode[];
    /** Map of Physical Path (FileID) to a list of Synthetic URIs where it appears */
    locationMap: Map<FileID, string[]>;
}

export class TreeBuilder {
    constructor(private app: App, private graph: IGraphEngine) {}

    /**
     * Builds a flattened tree view using a Depth-First Search (DFS).
     * Now uses a TreePipeline to handle filtering and sorting logic, separating traversal from transformation.
     */
    async *buildTree(context: ContextEngineV2, filterQuery?: string | null, forceExpandAll = false, overrideGroupId?: string | null): AsyncGenerator<void, TreeSnapshot, void> {
        const items: AbstractNode[] = [];
        const locationMap = new Map<FileID, string[]>();
        const state = context.getState();
        const activeGroupId = overrideGroupId !== undefined ? overrideGroupId : state.activeGroupId;

        Logger.debug(`[Abstract Folder] TreeBuilder: Starting build. activeGroupId: ${activeGroupId}`);

        // 1. Resolve Active Filter Config (Group vs Default)
        let activeFilterConfig = context.settings.defaultFilter;
        if (activeGroupId) {
            const group = context.settings.groups.find(g => g.id === activeGroupId);
            if (group && group.filter) {
                activeFilterConfig = group.filter;
            }
        }

        // 2. Resolve Roots via GraphEngine
        const roots = this.graph.getAllRoots(activeGroupId);
        Logger.debug(`[Abstract Folder] TreeBuilder: Graph returned ${roots.length} roots`);
        
        // 3. Initialize Pipeline
        const pipeline: TreePipeline = new StandardTreePipeline(this.app, this.graph, {
            sortConfig: state.sortConfig,
            filterQuery: filterQuery || state.activeFilter,
            groupRoots: new Set(roots),
            excludeExtensions: activeFilterConfig.excludeExtensions
        });

        // 3. Process Roots (Filtered & Sorted)
        /**
         * Architectural Rule: Filter Priority Stack
         * In V2, we enforce a strict precedence to ensure that user-defined "Hard Filters" (excluded extensions)
         * cannot be bypassed by structural rules or search matches.
         *
         * 1. HARD FILTER (isExcluded) -> Absolute rejection (e.g. user hides all PNGs)
         * 2. STRUCTURAL (isStructural) -> Absolute inclusion (Node is an entry point for an active Group)
         * 3. SEARCH (matches) -> Conditional inclusion (Node or descendants match query)
         */
        const filteredRoots = roots.filter(id => {
            const meta = this.graph.getNodeMeta?.(id);
            
            // Phase 1: Hard Exclusion (Extensions)
            if (pipeline.isExcluded(id, meta)) {
                return false;
            }

            // Phase 2: Structural Inclusion (Group Roots)
            if (pipeline.isStructural(id)) {
                return true;
            }

            // Phase 3: Search Matching
            return pipeline.matches(id, meta);
        });

        const sortedRoots = pipeline.sort(filteredRoots);
        
        // Use a reverse stack for DFS processing if pushing children in order
        const stack: Array<{ id: FileID, uri: string, level: number, visitedPath: Set<FileID> }> = [];
        for (let i = sortedRoots.length - 1; i >= 0; i--) {
            const r = sortedRoots[i];
            stack.push({
                id: r,
                uri: r,
                level: 0,
                visitedPath: new Set([r])
            });
        }

        let yieldCounter = 0;

        while (stack.length > 0) {
            const { id, uri, level, visitedPath } = stack.pop()!;
            
            const meta = this.graph.getNodeMeta?.(id);
            const rawChildren = this.graph.getChildren(id);
            
            const isExpanded = forceExpandAll || context.isExpanded(uri);
            
            /**
             * 1. Authoritative Filter Check (Filter Priority Stack)
             * We re-validate every node (roots and children) through the priority stack.
             */
            
            // Phase 1: Hard Exclusion (Extensions)
            // This is the absolute authority. If the extension is in the excluded list,
            // the node and its entire subtree are dropped immediately.
            if (pipeline.isExcluded(id, meta)) {
                Logger.debug(`[Abstract Folder] TreeBuilder: HARD EXCLUDED ${id}`);
                continue;
            }

            // Phase 2: Structural Inclusion (Group Roots)
            const isStructural = pipeline.isStructural(id);
            // Phase 3: Search Matching (Content/Name Query)
            const isMatch = pipeline.matches(id, meta);
            
            /**
             * Decision:
             * A node is only shown if it is a structural entry point (Group Root)
             * OR if it satisfies the active search/filter query.
             */
            if (!isStructural && !isMatch) {
                Logger.debug(`[Abstract Folder] TreeBuilder: FILTERED OUT ${id} (Search No-Match)`);
                continue;
            }

            Logger.debug(`[Abstract Folder] TreeBuilder: INCLUDING ${id} (isStructural: ${isStructural}, isMatch: ${isMatch})`);

            // 2. Rendering Decision
            // In V2, we render if it matches filters or is structural.
            // Note: recursiveSearchMatch handles "folder matches if child matches"
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
                icon: meta?.icon
            });
            
            // Track physical -> synthetic mapping
            const existing = locationMap.get(id) || [];
            existing.push(uri);
            locationMap.set(id, existing);

            // 3. Traversal Decision (Children)
            // We traverse children if:
            // - The node is expanded
            // - OR we are searching (to reveal children of a matching folder)
            const isSearching = !!(filterQuery && filterQuery.trim().length > 0);
            
            // 3. Traversal Decision (Children)
            // We traverse children if:
            // - The node is expanded
            // - OR we are searching (to reveal matching descendants)
            if (isExpanded || isSearching) {
                const sortedChildren = pipeline.sort(rawChildren);
                for (let i = sortedChildren.length - 1; i >= 0; i--) {
                    const childId = sortedChildren[i];
                    if (!visitedPath.has(childId)) {
                        stack.push({
                            id: childId,
                            uri: `${uri}/${childId}`,
                            level: level + 1,
                            visitedPath: new Set([...visitedPath, childId])
                        });
                    }
                }
            }

            // Yield control back to prevent UI freeze on large vaults
            if (++yieldCounter % 100 === 0) {
                yield;
            }
        }

        Logger.debug(`[Abstract Folder] TreeBuilder: Build complete. Generated ${items.length} nodes`);
        return { items, locationMap };
    }

    private getNodeName(path: string): string {
        return path.split('/').pop() || path;
    }
}
