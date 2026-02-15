import { FileID, IGraphEngine } from './graph-engine';
import { HIDDEN_FOLDER_ID } from '../types';
import { ContextEngineV2 } from './context-engine-v2';

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
        
        // Stack-based DFS
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
                lastFrameTime = performance.now();
            }

            const current = stack.pop()!;
            const { id, parentUri, depth, visitedPath } = current;

            const nodeName = this.getNodeName(id);
            const uri = `${parentUri}${nodeName}/`;

            if (visitedPath.has(id)) continue;

            const matchesFilter = !filterQuery || nodeName.toLowerCase().includes(filterQuery.toLowerCase());
            const children = this.graph.getChildren(id);
            const meta = this.graph.getNodeMeta(id);
            const isExpanded = forceExpandAll || context.isExpanded(uri);

            if (matchesFilter) {
                flatList.push({
                    id: uri,
                    path: id,
                    name: nodeName,
                    depth,
                    hasChildren: children.length > 0,
                    extension: meta?.extension || ''
                });

                if (!locationMap.has(id)) {
                    locationMap.set(id, []);
                }
                locationMap.get(id)!.push(uri);
            }

            // Process children if expanded OR if we are filtering (to find matches deeper)
            // If filtering, we might want to only show the path to the match.
            // For now, let's keep it simple: if filtering, we traverse everything but only add matches to flatList.
            // This is "Search" mode.
            if (children.length > 0 && (isExpanded || filterQuery)) {
                const nextVisitedPath = new Set(visitedPath);
                nextVisitedPath.add(id);

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
        if (lastSlash === -1) return path;
        return path.substring(lastSlash + 1);
    }
}
