import { FileID, IGraphEngine } from './graph-engine';
import { HIDDEN_FOLDER_ID } from '../types';
import { ContextEngineV2 } from './context-engine-v2';
import { Logger } from 'src/utils/logger';

/**
 * Represents a node in the flattened tree view.
 * This is the "Projection" of a GraphNode into a specific contextual path.
 */
export interface AbstractNode {
    /** Synthetic URI: view://Root/Parent/Node/ */
    id: string;
    /** The physical file path */
    path: FileID;
    /** Display name */
    name: string;
    /** Visual depth in the tree (0-indexed) */
    depth: number;
    /** Whether this node has children in the graph */
    hasChildren: boolean;
    /** Metadata from the graph */
    extension: string;
}

/**
 * Maps a physical file to all its occurrences in the tree.
 * Used for "Reveal in Tree" and Search.
 */
export type NodeLocationMap = Map<FileID, string[]>;

export interface TreeSnapshot {
    flatList: AbstractNode[];
    locationMap: NodeLocationMap;
}

/**
 * The TreeBuilder transforms the cyclic Graph into a linear, virtualized list.
 */
export class TreeBuilder {
    private graph: IGraphEngine;
    private timeBudget = 12; // ms per frame

    constructor(graph: IGraphEngine) {
        this.graph = graph;
    }

    /**
     * Builds the tree snapshot iteratively and with time-slicing.
     * Returns a generator that yields when the time budget is exceeded.
     */
    async *buildTree(context: ContextEngineV2, filterQuery?: string | null, forceExpandAll = false): AsyncGenerator<void, TreeSnapshot, void> {
        const flatList: AbstractNode[] = [];
        const locationMap: NodeLocationMap = new Map();
        
        const roots = this.graph.getAllRoots();
        Logger.debug(`[Abstract Folder] TreeBuilder: Found ${roots.length} roots`, roots);
        
        // --- PRE-PROCESS: Search Expansion ---
        const expandedBySearch = new Set<string>();
        if (filterQuery) {
            const searchStack: Array<{ id: FileID, uri: string, visitedPath: Set<FileID> }> = roots.map(r => ({
                id: r,
                uri: `view://${this.getNodeName(r)}/`,
                visitedPath: new Set()
            }));

            while (searchStack.length > 0) {
                const cur = searchStack.pop()!;
                if (cur.visitedPath.has(cur.id)) continue;
                
                const nodeName = this.getNodeName(cur.id);
                if (nodeName.toLowerCase().includes(filterQuery.toLowerCase())) {
                    // Mark path to match as expanded
                    const parts = cur.uri.split('/').filter(Boolean); // ["view:", "Root", "Child"]
                    let running = 'view://';
                    // The last part is the node itself, parents are everything before it
                    for (let i = 1; i < parts.length; i++) {
                        running += `${parts[i]}/`;
                        expandedBySearch.add(running);
                    }
                }

                const children = this.graph.getChildren(cur.id);
                const nextVisited = new Set(cur.visitedPath);
                nextVisited.add(cur.id);

                for (const childId of children) {
                    searchStack.push({
                        id: childId,
                        uri: `${cur.uri}${this.getNodeName(childId)}/`,
                        visitedPath: nextVisited
                    });
                }
            }
            Logger.debug(`[Abstract Folder] TreeBuilder: Search expansion complete. Expanded ${expandedBySearch.size} URIs`);
        }

        // --- STAGE 2: Flattening DFS ---
        const stack: Array<{
            id: FileID;
            parentUri: string;
            depth: number;
            visitedPath: Set<FileID>;
        }> = [];

        for (const rootId of [...roots].reverse()) {
            stack.push({
                id: rootId,
                parentUri: 'view://',
                depth: 0,
                visitedPath: new Set()
            });
        }

        let lastFrameTime = performance.now();

        while (stack.length > 0) {
            const now = performance.now();
            if (now - lastFrameTime > this.timeBudget) {
                yield;
                lastFrameTime = performance.now();
            }

            const current = stack.pop()!;
            const { id, parentUri, depth, visitedPath } = current;

            const nodeName = this.getNodeName(id);
            // Sanitize node name for URI to prevent trailing slashes in name or double slashes
            // For folders, we keep the trailing slash to indicate it's a container
            const sanitizedName = nodeName.replace(/\//g, '_');
            const uri = `${parentUri}${sanitizedName}/`;

            const children = this.graph.getChildren(id);
            const isExpandedInContext = context.isExpanded(uri);
            const isExpandedBySearch = expandedBySearch.has(uri);
            const isExpanded = forceExpandAll || isExpandedInContext || isExpandedBySearch;

            Logger.debug(`[Abstract Folder] TreeBuilder: Step - ${id}`, {
                uri,
                depth,
                isExpanded,
                childCount: children.length
            });

            if (visitedPath.has(id)) {
                Logger.debug(`[Abstract Folder] TreeBuilder: Cycle detected for ${id}, skipping`);
                continue;
            }

            const matchesFilter = !filterQuery || nodeName.toLowerCase().includes(filterQuery.toLowerCase());
            const meta = this.graph.getNodeMeta(id);

            if (matchesFilter) {
                // For display name, we strip the extension if it's .md
                const displayName = nodeName.endsWith('.md') ? nodeName.substring(0, nodeName.length - 3) : nodeName;

                flatList.push({
                    id: uri,
                    path: id,
                    name: displayName,
                    depth,
                    hasChildren: children.length > 0,
                    extension: meta?.extension || ''
                });

                if (!locationMap.has(id)) {
                    locationMap.set(id, []);
                }
                locationMap.get(id)!.push(uri);
            }

            // Process children if expanded
            if (children.length > 0 && isExpanded) {
                const nextVisitedPath = new Set(visitedPath);
                nextVisitedPath.add(id);

                Logger.debug(`[Abstract Folder] TreeBuilder: Expanding ${id}, pushing ${children.length} children`);
                for (const childId of [...children].reverse()) {
                    stack.push({
                        id: childId,
                        parentUri: uri,
                        depth: depth + 1,
                        visitedPath: nextVisitedPath
                    });
                }
            }
        }

        return { flatList, locationMap };
    }

    private getNodeName(path: string): string {
        if (path === HIDDEN_FOLDER_ID) return 'Hidden';
        const lastSlash = path.lastIndexOf('/');
        const fullName = lastSlash === -1 ? path : path.substring(lastSlash + 1);
        
        // IMPORTANT: We MUST keep the filename exactly as is for URI uniqueness.
        // If we strip .md here, URIs for "Note.md" and "Note.pdf" will collide.
        // We only strip .md for display name.
        return fullName;
    }
}
