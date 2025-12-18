import { FolderNode } from "../types";

export interface FlatItem {
    node: FolderNode;
    depth: number;
    parentPath: string | null;
}

export function flattenTree(
    nodes: FolderNode[],
    expandedFolders: Set<string>,
    depth: number = 0,
    parentPath: string | null = null,
    result: FlatItem[] = []
): FlatItem[] {
    for (const node of nodes) {
        result.push({ node, depth, parentPath });
        if (node.isFolder && expandedFolders.has(node.path)) {
            flattenTree(node.children, expandedFolders, depth + 1, node.path, result);
        }
    }
    return result;
}
