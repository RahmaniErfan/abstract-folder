import { App } from "obsidian";
import { FileID, IGraphEngine } from "./graph-engine";
import { ContextEngine } from "./context-engine";
import { TreePipeline, StandardTreePipeline } from "./tree-pipeline";
import { Logger } from "../utils/logger";
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
    async *buildTree(
        context: ContextEngine, 
        filterQuery?: string | null, 
        forceExpandAll = false, 
        overrideGroupId?: string | null,
        searchOptions?: { showAncestors?: boolean, showDescendants?: boolean }
    ): AsyncGenerator<void, TreeSnapshot, void> {
        const items: AbstractNode[] = [];
        const locationMap = new Map<FileID, string[]>();
        const state = context.getState();
        const activeGroupId = overrideGroupId !== undefined ? overrideGroupId : state.activeGroupId;
        const stateStr = JSON.stringify({ activeGroupId, filterQuery, forceExpandAll });
        Logger.debug(`[Abstract Folder] TreeBuilder: buildTree started with state: ${stateStr}`);


        // 1. Resolve Active Filter Config (Group vs Default)
        let activeFilterConfig = context.settings.defaultFilter;
        if (activeGroupId) {
            const group = context.settings.groups.find(g => g.id === activeGroupId);
            if (group && group.filter) {
                activeFilterConfig = group.filter;
            }
        }

        // 2. Resolve Roots via GraphEngine
        const isSearching = !!(filterQuery && filterQuery.trim().length > 0);
        const searchShowAncestors = searchOptions?.showAncestors ?? context.settings.searchShowAncestors;
        const searchShowDescendants = searchOptions?.showDescendants ?? context.settings.searchShowDescendants;

        // Path-based scoping (useful for Library View)
        const isGroupMeta = context.settings.groups.some(g => g.id === activeGroupId);
        const scopePrefix = (activeGroupId && !isGroupMeta) 
            ? (activeGroupId.endsWith('/') ? activeGroupId : activeGroupId + '/') 
            : null;

        // 3. Initialize Pipeline
        const pipeline: TreePipeline = new StandardTreePipeline(this.app, this.graph, {
            sortConfig: state.sortConfig,
            filterQuery: filterQuery || state.activeFilter,
            groupRoots: new Set(), // Will be updated
            excludeExtensions: activeFilterConfig.excludeExtensions,
            searchShowDescendants: searchShowDescendants,
            searchShowAncestors: searchShowAncestors
        });

        let roots = this.graph.getAllRoots(activeGroupId);

        // 2b. If searching and NOT showing all ancestors, we want matches to appear as roots
        const libraryPath = context.settings.librarySettings.librariesPath;
        const groupFolders = activeGroupId ? context.settings.groups.find(g => g.id === activeGroupId)?.parentFolders : null;
        
        // Capture structural roots for abstract ancestry check
        const structuralRoots = new Set(roots); 

        if (isSearching && !searchShowAncestors) {
            const query = (filterQuery || state.activeFilter)!.toLowerCase();
            const matchingNodes: FileID[] = [];
            
            // We iterate over ONLY files in the vault that are within the scoped path if a path-based scope is active.
            const allFiles = this.app.vault.getFiles();
            for (const file of allFiles) {
                // 1. Group Scoping
                // Physical Check OR Abstract Ancestry Check
                let isInGroup = false;
                if (groupFolders) {
                    // A. Physical Check
                    if (groupFolders.some(folder => file.path.startsWith(folder))) {
                        isInGroup = true;
                    }
                    // B. Abstract Ancestry Check (if not physically in group)
                    else if (structuralRoots.size > 0 && this.isDescendantOf(file.path, structuralRoots)) {
                        isInGroup = true;
                    }
                    
                    if (!isInGroup) continue;
                }

                // 2. Path-based Scoping (Library/Folders)
                if (scopePrefix && file.path !== activeGroupId && !file.path.startsWith(scopePrefix)) {
                    continue;
                }

                // 3. Main View Scoping: Exclude libraries
                if (!activeGroupId && libraryPath && (file.path === libraryPath || file.path.startsWith(libraryPath + '/'))) {
                    continue;
                }

                if (file.name.toLowerCase().includes(query)) {
                    matchingNodes.push(file.path);
                }
            }
            roots = matchingNodes;

            // [FIX] Avoid duplication when showAncestors is OFF but showDescendants is ON.
            // If a node matches and one of its ancestors also matches, we don't want to promote 
            // the child to a root, because it will already be rendered as a descendant of that matching ancestor.
            if (searchShowDescendants) {
                const matchingSet = new Set(matchingNodes);
                roots = matchingNodes.filter(id => !this.isDescendantOf(id, matchingSet));
            }
        }
        
        // Update pipeline with resolved roots
        (pipeline as StandardTreePipeline).updateGroupRoots(new Set(roots));

        // 3. Process Roots (Filtered & Sorted)
        /**
         * Architectural Rule: Filter Priority Stack
         * In the new architecture, we enforce a strict precedence to ensure that user-defined "Hard Filters" (excluded extensions)
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
            // In search mode, we prioritize direct matches or paths to matches.
            return pipeline.matches(id, meta);
        });

        const sortedRoots = pipeline.sort(filteredRoots);
        
        // Use a reverse stack for DFS processing if pushing children in order
        const stack: Array<{ id: FileID, uri: string, level: number, visitedPath: Set<FileID>, parentId?: FileID }> = [];
        for (let i = sortedRoots.length - 1; i >= 0; i--) {
            const r = sortedRoots[i];
            stack.push({
                id: r,
                uri: r,
                level: 0,
                visitedPath: new Set([r]),
                parentId: undefined // Roots have no parent in this context
            });
        }

        let yieldCounter = 0;

        while (stack.length > 0) {
            const { id, uri, level, visitedPath, parentId } = stack.pop()!;
            
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
                continue;
            }

            // [STRICT SCOPE CHECK]
            // Ensure no nodes leak from outside the defined scope (important for Library View)
            if (scopePrefix && id !== activeGroupId && !id.startsWith(scopePrefix)) {
                continue;
            }

            // [MAIN VIEW SCOPE CHECK]
            // Ensure library files AND shared spaces don't leak into the main view
            if (!activeGroupId) {
                if (libraryPath && (id === libraryPath || id.startsWith(libraryPath + '/'))) {
                    continue;
                }
                const sharedSpacesRoot = context.settings.librarySettings.sharedSpacesRoot || "Abstract Spaces";
                if (id === sharedSpacesRoot || id.startsWith(sharedSpacesRoot + '/')) {
                    continue;
                }
            }

            // Phase 2: Structural Inclusion (Group Roots)
            // IN SEARCH MODE: We ignore structural rules to keep results clean.
            const isStructural = !isSearching && pipeline.isStructural(id);

            // Phase 3: Search Matching (Content/Name Query)
            // In V2, we strictly follow the matches() result for search.
            // We find the parent ID from the stack entry if it exists to allow path-aware matching
            const isMatch = isSearching ? pipeline.matches(id, meta, parentId) : true;

            /**
             * Decision:
             * A node is only shown if it is a structural entry point (Group Root)
             * OR if it satisfies the active search/filter query.
             */
            // [REFINED DECISION]
            // We only show the node if:
            // 1. It's a structural group root (not in search mode)
            // 2. OR it's search mode AND the node itself matches OR leads to a match in this branch.
            if (!isStructural && (isSearching && !isMatch)) {
                continue;
            }

            // [ADDITIONAL NOISE REDUCTION]
            // If Show Ancestors is ON, we only show nodes that actually match or lead to a match.
            // If it's OFF, the TreeBuilder has already promoted matches to roots, so we don't need to skip here.


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
                icon: meta?.icon,
                isLibrary: meta?.isLibrary,
                isShared: meta?.isShared,
                isBackup: meta?.isBackup
            });
            
            // Track physical -> synthetic mapping
            const existing = locationMap.get(id) || [];
            existing.push(uri);
            locationMap.set(id, existing);

            // 3. Traversal Decision (Children)
            // We traverse children if:
            // - The node is expanded
            // - OR we are searching (to reveal children of a matching folder)
            
            // 3. Traversal Decision (Children)
            // We traverse children if:
            // - The node is expanded
            // - OR we are searching (to reveal matching descendants)
            // - OR Show Children is enabled and this node is a match (this is handled by matches() returning true for descendants, but we need to ensure we step into the match)
            // We traverse children if:
            // - The node is expanded (Standard Tree View)
            // - OR we are searching AND (Show Ancestors is ON OR Show Descendants is ON OR the node is a Direct Match)
            // [PATH-SPECIFIC TRAVERSAL]
            // We only step into children if:
            // 1. The node is explicitly expanded by the user
            // 2. OR we are searching AND (Show Descendants is ON OR this SPECIFIC branch leads to a match)
            // Note: isMatch already includes DESCENDANT MATCH check, so it correctly identifies if this branch leads to a match.
            // 2. OR we are searching AND (Show Descendants is ON OR this SPECIFIC branch leads to a match)
            // Note: isMatch already includes DESCENDANT MATCH check, so it correctly identifies if this branch leads to a match.
            const shouldTraverseChildren = isExpanded || (isSearching && (searchShowDescendants || isMatch));

            if (shouldTraverseChildren) {
                const sortedChildren = pipeline.sort(rawChildren);
                // We MUST push children to the stack in REVERSE order to maintain
                // the correct DFS visual order when popping.
                for (let i = sortedChildren.length - 1; i >= 0; i--) {
                    const childId = sortedChildren[i];
                    if (!visitedPath.has(childId)) {
                        const childURI = `${uri}/${childId}`;
                        stack.push({
                            id: childId,
                            uri: childURI,
                            level: level + 1,
                            visitedPath: new Set([...visitedPath, childId]),
                            parentId: id // Pass current ID as parent for the next level
                        });
                    }
                }
            }

            // Yield control back to prevent UI freeze on large vaults
            if (++yieldCounter % 50 === 0) {
                Logger.debug(`[Abstract Folder] TreeBuilder: Processing... reached ${items.length} items`);
                yield;
            }
        }

        Logger.debug(`[Abstract Folder] TreeBuilder: buildTree complete, total items: ${items.length}`);
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
