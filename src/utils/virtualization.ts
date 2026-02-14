import { App, TFile } from "obsidian";
import { FileGraph, FolderNode, HIDDEN_FOLDER_ID, Group } from "../types";
import { createFolderNode, resolveGroupRoots } from "./tree-utils";
import { getContextualId } from "./context-utils";

export interface FlatItem {
    node: FolderNode;
    depth: number;
    parentPath: string | null;
    contextId: string;
}

export function flattenTree(
    nodes: FolderNode[],
    expandedFolders: Set<string>,
    depth: number = 0,
    parentPath: string | null = null,
    result: FlatItem[] = [],
    forcedRootContext: string | null = null
): FlatItem[] {
    for (const node of nodes) {
        // 1. Generate Context ID
        // For Depth 0, we allow forcing a specific root context (e.g. "root")
        const effectiveParentPathForContext = (depth === 0 && forcedRootContext) ? forcedRootContext : parentPath;
        const contextId = getContextualId(node.path, effectiveParentPathForContext);
        
        // 2. Add to result
        result.push({ node, depth, parentPath, contextId });
        
        // 3. Recurse if expanded
        // Abstract Philosophy: Any node with children acts as a folder
        const hasChildren = node.children && node.children.length > 0;
        const isExpanded = expandedFolders.has(contextId);
        
        if (hasChildren && isExpanded) {
            flattenTree(
                node.children,
                expandedFolders,
                depth + 1,
                node.path, // Children always use their actual parent's path
                result,
                null // Propagation stops after depth 0
            );
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
            if (node.file instanceof TFile && excludeExtensions.includes(node.file.extension.toLowerCase())) {
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
        const contextId = getContextualId(node.path, parentPath);
        flatItems.push({ node, depth, parentPath, contextId });
        
        // Lazy Recursion: Only if expanded
        // During search, we might want to show children even if not explicitly in expandedFolders
        // but typically expandedFolders will contain what we want to show.
        const isExpanded = expandedFolders.has(contextId);
        if (node.isFolder && isExpanded) {
            const childrenPaths = parentToChildren[node.path];
            if (childrenPaths && childrenPaths.size > 0) {
                const childNodes: FolderNode[] = [];
                for (const childPath of childrenPaths) {
                     // Check to avoid cycles if needed, though graph should handle it
                     if (childPath === node.path) continue; // Basic cycle prevention

                     const childNode = createFolderNode(app, childPath, graph);
                     if (childNode) {
                        if (childNode.file instanceof TFile && excludeExtensions.includes(childNode.file.extension.toLowerCase())) {
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
        } else if (node.isFolder) {
            if (expandedFolders.size > 10) {
                console.debug(`[Abstract Folder] Virtualization: Folder NOT expanded: ${contextId}. isFolder: ${node.isFolder}, in set: ${expandedFolders.has(contextId)}`);
            }
        }
    }

    return flatItems;
}
