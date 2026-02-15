import { FileID, IGraphEngine } from './graph-engine';
import { HIDDEN_FOLDER_ID } from '../types';

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
    async *buildTree(): AsyncGenerator<void, TreeSnapshot, void> {
        const flatList: AbstractNode[] = [];
        const locationMap: NodeLocationMap = new Map();
        
        const roots = this.graph.getAllRoots();
        
        // Stack-based DFS
        // Each entry: { id, parentUri, depth, visitedPath }
        const stack: Array<{
            id: FileID;
            parentUri: string;
            depth: number;
            visitedPath: Set<FileID>;
        }> = [];

        // Push roots to stack in reverse order to process them in alphabetical order
        // (Since it's a stack, last-in first-out)
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
            // Check time budget
            const now = performance.now();
            if (now - lastFrameTime > this.timeBudget) {
                yield;
                lastFrameTime = performance.now();
            }

            const current = stack.pop()!;
            const { id, parentUri, depth, visitedPath } = current;

            // 1. Generate Synthetic URI
            // We append a slash to ensure "Folder" doesn't match "Folder-Backup" in prefix checks
            const nodeName = this.getNodeName(id);
            const uri = `${parentUri}${nodeName}/`;

            // 2. Cycle Detection
            if (visitedPath.has(id)) {
                // TODO: Maybe add a special "Loop" node
                continue;
            }

            // 3. Add to Snapshot
            const children = this.graph.getChildren(id);
            const meta = this.graph.getNodeMeta(id);

            flatList.push({
                id: uri,
                path: id,
                name: nodeName,
                depth,
                hasChildren: children.length > 0,
                extension: meta?.extension || ''
            });

            // Update Inverse Index
            if (!locationMap.has(id)) {
                locationMap.set(id, []);
            }
            locationMap.get(id)!.push(uri);

            // 4. Process Children
            if (children.length > 0) {
                const nextVisitedPath = new Set(visitedPath);
                nextVisitedPath.add(id);

                // Push children to stack in reverse order for correct visual sorting
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
