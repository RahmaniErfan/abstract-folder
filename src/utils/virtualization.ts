import { App } from "obsidian";
import { FileGraph, FolderNode, HIDDEN_FOLDER_ID, Group } from "../types";
import { createFolderNode, resolveGroupRoots } from "./tree-utils";

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

export function generateFlatItemsFromGraph(
    app: App,
    graph: FileGraph,
    expandedFolders: Set<string>,
    sortComparator: (a: FolderNode, b: FolderNode) => number,
    activeGroup?: Group,
    excludeExtensions: string[] = [],
    isSearching: boolean = false
): FlatItem[] {
    const flatItems: FlatItem[] = [];
    const parentToChildren = graph.parentToChildren;
    
    // 1. Identify Roots
    let rootPaths: string[] = [];
    if (activeGroup && !isSearching) {
        // Use shared logic for group roots
        rootPaths = resolveGroupRoots(app, graph, activeGroup);
    } else {
        // Default logic: use graph roots
        rootPaths = Array.from(graph.roots);
        
        // Ensure HIDDEN_FOLDER_ID is included if it has children
        if (graph.parentToChildren[HIDDEN_FOLDER_ID] && graph.parentToChildren[HIDDEN_FOLDER_ID].size > 0) {
            if (!rootPaths.includes(HIDDEN_FOLDER_ID)) {
                rootPaths.push(HIDDEN_FOLDER_ID);
            }
        }
    }

    // 2. Create and Sort Root Nodes
    const rootNodes: FolderNode[] = [];
    for (const path of rootPaths) {
        const node = createFolderNode(app, path, graph);
        if (node) {
            if (node.file && excludeExtensions.includes(node.file.extension.toLowerCase())) {
                continue;
            }
            rootNodes.push(node);
        }
    }
    rootNodes.sort(sortComparator);
    
    // 3. Traverse Depth-First
    for (const node of rootNodes) {
        traverse(node, 0, null);
    }
    
    function traverse(node: FolderNode, depth: number, parentPath: string | null) {
        // console.log("Traversing node:", node.path, "Depth:", depth, "Parent:", parentPath);
        flatItems.push({ node, depth, parentPath });
        
        // Lazy Recursion: Only if expanded
        // During search, we might want to show children even if not explicitly in expandedFolders
        // but typically expandedFolders will contain what we want to show.
        if (node.isFolder && expandedFolders.has(node.path)) {
            const childrenPaths = parentToChildren[node.path];
            if (childrenPaths && childrenPaths.size > 0) {
                const childNodes: FolderNode[] = [];
                for (const childPath of childrenPaths) {
                     // Check to avoid cycles if needed, though graph should handle it
                     if (childPath === node.path) continue; // Basic cycle prevention

                     const childNode = createFolderNode(app, childPath, graph);
                     if (childNode) {
                        if (childNode.file && excludeExtensions.includes(childNode.file.extension.toLowerCase())) {
                            continue;
                        }
                        childNodes.push(childNode);
                     }
                }
                childNodes.sort(sortComparator);
                
                for (const child of childNodes) {
                    traverse(child, depth + 1, node.path);
                }
            }
        }
    }

    return flatItems;
}
