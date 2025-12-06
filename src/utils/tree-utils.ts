import { App, TFile } from "obsidian";
import { FileGraph, FolderNode, HIDDEN_FOLDER_ID } from "../types";

export function buildFolderTree(
    app: App, 
    graph: FileGraph, 
    sortComparator: (a: FolderNode, b: FolderNode) => number
): FolderNode[] {
    const allFilePaths = graph.allFiles;
    const parentToChildren = graph.parentToChildren;
    const childToParents = graph.childToParents;

    const nodesMap = new Map<string, FolderNode>();

    // Create all possible nodes
    allFilePaths.forEach(path => {
        const file = app.vault.getAbstractFileByPath(path);
        nodesMap.set(path, {
            file: file instanceof TFile ? file : null,
            path: path,
            children: [],
            isFolder: Object.keys(parentToChildren).includes(path) || path === HIDDEN_FOLDER_ID,
            icon: file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter?.icon : undefined,
            isHidden: path === HIDDEN_FOLDER_ID,
        });
    });

    const hiddenNodes = new Set<string>();

    const identifyHiddenChildren = (nodePath: string) => {
        if (hiddenNodes.has(nodePath)) return;
        hiddenNodes.add(nodePath);

        const children = parentToChildren[nodePath];
        if (children) {
            children.forEach(childPath => identifyHiddenChildren(childPath));
        }
    };

    if (parentToChildren[HIDDEN_FOLDER_ID]) {
        parentToChildren[HIDDEN_FOLDER_ID].forEach(childPath => {
            const childNode = nodesMap.get(childPath);
            if (childNode) {
                childNode.isHidden = true;
                identifyHiddenChildren(childPath);
            }
        });
    }

    // Build parent-child relationships
    for (const parentPath in parentToChildren) {
        parentToChildren[parentPath].forEach(childPath => {
            const parentNode = nodesMap.get(parentPath);
            const childNode = nodesMap.get(childPath);

            if (parentNode && childNode) {
                if (parentPath === HIDDEN_FOLDER_ID || !hiddenNodes.has(childPath)) {
                    parentNode.children.push(childNode);
                }
            }
        });
    }

    // Sort children
    nodesMap.forEach(node => {
        node.children.sort(sortComparator);
    });

    // Identify root nodes
    const rootPaths = new Set(allFilePaths);
    childToParents.forEach((_, childPath) => {
        if (rootPaths.has(childPath) && !hiddenNodes.has(childPath)) {
            rootPaths.delete(childPath);
        }
    });

    const sortedRootNodes: FolderNode[] = [];
    
    // Add Hidden folder if applicable
    const hiddenFolderNode = nodesMap.get(HIDDEN_FOLDER_ID);
    if (hiddenFolderNode && hiddenFolderNode.children.length > 0) {
        sortedRootNodes.push(hiddenFolderNode);
    }

    // Add other roots
    rootPaths.forEach(path => {
        const node = nodesMap.get(path);
        if (node && !hiddenNodes.has(node.path) && node.path !== HIDDEN_FOLDER_ID) {
            sortedRootNodes.push(node);
        }
    });

    sortedRootNodes.sort(sortComparator);
    return sortedRootNodes;
}