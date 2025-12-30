import { FolderIndexer } from "../indexer";

export interface AncestryPath {
    segments: string[];
}

export interface RelationshipReason {
    parent: string;
    child: string;
    definedByParent: boolean;
    definedByChild: boolean;
}

export type AncestryNodeType = 'target' | 'ancestor' | 'sibling' | 'root';

export interface AncestryNode {
    data: {
        id: string;
        label: string;
        type: AncestryNodeType;
        fullPath: string;
    };
}

export interface AncestryEdge {
    data: {
        id: string;
        source: string;
        target: string;
    };
}

export class AncestryEngine {
    constructor(private indexer: FolderIndexer) {}

    /**
     * Finds all paths from roots to a target file.
     * Uses backward traversal (child to parents) to find all routes.
     */
    getAllPaths(targetPath: string): AncestryPath[] {
        const graph = this.indexer.getGraph();
        const results: AncestryPath[] = [];
        const visited = new Set<string>();

        const traverse = (current: string, currentPath: string[]) => {
            if (visited.has(current)) {
                // Potential cycle or already processed path
                return;
            }

            const parents = graph.childToParents.get(current);
            
            if (!parents || parents.size === 0) {
                // Root reached
                results.push({ segments: [...currentPath].reverse() });
                return;
            }

            visited.add(current);
            for (const parent of parents) {
                currentPath.push(parent);
                traverse(parent, currentPath);
                currentPath.pop();
            }
            visited.delete(current);
        };

        traverse(targetPath, [targetPath]);
        return results;
    }

    /**
     * Gets all siblings of a file across all its parent contexts.
     */
    getNeighborhood(targetPath: string): Map<string, string[]> {
        const graph = this.indexer.getGraph();
        const neighborhood = new Map<string, string[]>();
        
        const parents = graph.childToParents.get(targetPath);
        if (!parents) return neighborhood;

        for (const parent of parents) {
            const children = graph.parentToChildren[parent];
            if (children) {
                neighborhood.set(parent, Array.from(children).filter(c => c !== targetPath));
            }
        }

        return neighborhood;
    }

    /**
     * Determines the reasons for relationships (defined by parent vs child).
     */
    getRelationshipReasons(targetPath: string): RelationshipReason[] {
        const graph = this.indexer.getGraph();
        const allDefs = this.indexer.getAllFileRelationships();
        const reasons: RelationshipReason[] = [];

        const parents = graph.childToParents.get(targetPath);
        if (parents) {
            for (const parent of parents) {
                const parentDefs = allDefs.get(parent);
                const childDefs = allDefs.get(targetPath);

                reasons.push({
                    parent: parent,
                    child: targetPath,
                    definedByParent: parentDefs?.definedChildren.has(targetPath) ?? false,
                    definedByChild: childDefs?.definedParents.has(parent) ?? false
                });
            }
        }

        return reasons;
    }

    /**
     * Builds a minimal graph representation for Cytoscape.
     * Includes the target file, all its ancestors, and immediate siblings.
     */
    getAncestryGraphData(targetPath: string): { nodes: AncestryNode[], edges: AncestryEdge[] } {
        const nodes: AncestryNode[] = [];
        const edges: AncestryEdge[] = [];
        const addedNodes = new Set<string>();
        const addedEdges = new Set<string>();

        const addNode = (path: string, type: AncestryNodeType) => {
            if (addedNodes.has(path)) return;
            addedNodes.add(path);
            nodes.push({
                data: { 
                    id: path, 
                    label: path.split('/').pop() || path,
                    type: type,
                    fullPath: path
                }
            });
        };

        const addEdge = (source: string, target: string) => {
            const id = `${source}->${target}`;
            if (addedEdges.has(id)) return;
            addedEdges.add(id);
            edges.push({
                data: { id: id, source: source, target: target }
            });
        };

        // 1. Add target
        addNode(targetPath, 'target');

        // 2. Add all ancestors and their connections
        const paths = this.getAllPaths(targetPath);
        for (const path of paths) {
            for (let i = 0; i < path.segments.length; i++) {
                const current = path.segments[i];
                const isRoot = i === 0;
                const isTarget = current === targetPath;
                
                addNode(current, isTarget ? 'target' : (isRoot ? 'root' : 'ancestor'));
                
                if (i > 0) {
                    addEdge(path.segments[i-1], current);
                }
            }
        }

        // 3. Add immediate siblings for context
        const neighborhood = this.getNeighborhood(targetPath);
        neighborhood.forEach((siblings, parent) => {
            const existingNode = nodes.find(n => n.data.id === parent);
            addNode(parent, existingNode ? existingNode.data.type : 'ancestor');
            for (const sibling of siblings) {
                addNode(sibling, 'sibling');
                addEdge(parent, sibling);
            }
        });

        return { nodes, edges };
    }
}
