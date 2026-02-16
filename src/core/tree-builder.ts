import { App } from "obsidian";
import { FileID, IGraphEngine } from "./graph-engine";
import { ContextEngineV2 } from "./context-engine-v2";
import { TreePipeline, StandardTreePipeline } from "./tree-pipeline";
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

        // 1. Resolve Roots via GraphEngine
        const roots = this.graph.getAllRoots(overrideGroupId !== undefined ? overrideGroupId : state.activeGroupId);
        
        // 2. Initialize Pipeline
        const pipeline: TreePipeline = new StandardTreePipeline(this.app, this.graph, {
            sortConfig: state.sortConfig,
            filterQuery: filterQuery || state.activeFilter,
            groupRoots: new Set(roots),
            hideImages: context.settings.defaultFilter.excludeExtensions.includes('png') || context.settings.defaultFilter.excludeExtensions.includes('jpg'),
            hideCanvas: context.settings.defaultFilter.excludeExtensions.includes('canvas')
        });

        // 3. Process Roots (Filtered & Sorted)
        // Roots are only allowed if they are Structural (Active Group Roots) OR if they match filters
        const filteredRoots = roots.filter(id => {
            const isStructural = pipeline.isStructural(id);
            const meta = this.graph.getNodeMeta?.(id);
            const isMatch = pipeline.matches(id, meta);
            return isStructural || isMatch;
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
            
            // 1. Authoritative Filter Check
            const isMatch = pipeline.matches(id, meta);
            const isStructural = pipeline.isStructural(id);
            
            // A node is only eligible for the tree if it matches filters OR is a group root
            if (!isMatch && !isStructural) {
                continue;
            }

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

        return { items, locationMap };
    }

    private getNodeName(path: string): string {
        return path.split('/').pop() || path;
    }
}
