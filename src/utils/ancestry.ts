import { FolderIndexer } from "../indexer";

export interface AncestryPath {
    segments: string[];
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
                return;
            }

            const parents = graph.childToParents.get(current);
            
            if (!parents || parents.size === 0) {
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
     * Gets all nodes that belong to any path from a root to the target.
     */
    getAncestryNodePaths(targetPath: string): Set<string> {
        const paths = this.getAllPaths(targetPath);
        const allowedPaths = new Set<string>();
        for (const path of paths) {
            for (const segment of path.segments) {
                allowedPaths.add(segment);
            }
        }
        return allowedPaths;
    }
}
