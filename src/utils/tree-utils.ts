import { App, TFile } from "obsidian";
import { FileGraph, FolderNode, HIDDEN_FOLDER_ID, Group } from "../types";

/**
 * Creates a single FolderNode from a path.
 * Returns null if the path does not represent a valid node in our graph context.
 */
export function createFolderNode(app: App, path: string, graph: FileGraph): FolderNode | null {
    if (path === HIDDEN_FOLDER_ID) {
        return {
            file: null,
            path: path,
            children: [],
            isFolder: true,
            isHidden: true
        };
    }

    const file = app.vault.getAbstractFileByPath(path);
    const parentToChildren = graph.parentToChildren;

    // Determine if it is a folder (has children in graph)
    const hasChildren = parentToChildren[path] && parentToChildren[path].size > 0;
    const isFolder = hasChildren || path === HIDDEN_FOLDER_ID;

    // If it's not a valid file and not a known parent, skip it.
    // In Abstract Folder, usually nodes are TFiles or the Hidden folder.
    if (!file && !hasChildren) {
        return null;
    }

    let icon: string | undefined;
    if (file instanceof TFile) {
        const cache = app.metadataCache.getFileCache(file);
        // Fix for "Unsafe assignment of an `any` value"
        icon = cache?.frontmatter?.icon as string | undefined;
    }

    return {
        file: file instanceof TFile ? file : null,
        path: path,
        children: [], // Children are not populated initially
        isFolder: isFolder,
        icon: icon,
        isHidden: path === HIDDEN_FOLDER_ID
    };
}

/**
 * Resolves the root paths for a specific group.
 */
export function resolveGroupRoots(app: App, graph: FileGraph, group: Group): string[] {
    const explicitPaths = group.parentFolders;
    const processedRoots = new Set<string>();

    for (const includedPath of explicitPaths) {
        // Logic: check path, then folder note, then sibling note
        let targetPath = includedPath;
        let file = app.vault.getAbstractFileByPath(targetPath);

        if (!file) {
            const folderName = includedPath.split('/').pop();
            if (folderName) {
                const insideNotePath = `${includedPath}/${folderName}.md`;
                if (app.vault.getAbstractFileByPath(insideNotePath)) {
                    targetPath = insideNotePath;
                }
            }
        }

        if (!app.vault.getAbstractFileByPath(targetPath)) {
            if (!targetPath.endsWith('.md')) {
                const siblingNotePath = `${targetPath}.md`;
                if (app.vault.getAbstractFileByPath(siblingNotePath)) {
                    targetPath = siblingNotePath;
                }
            }
        }

        // Verify it exists in graph or vault
        if (graph.allFiles.has(targetPath) || app.vault.getAbstractFileByPath(targetPath)) {
            processedRoots.add(targetPath);
        }
    }
    return Array.from(processedRoots);
}

/**
 * Builds a full tree of FolderNodes.
 * This is used for Column View and Legacy Tree View.
 */
export function buildFolderTree(
    app: App,
    graph: FileGraph,
    sortComparator: (a: FolderNode, b: FolderNode) => number
): FolderNode[] {
    const allFilePaths = graph.allFiles;
    const parentToChildren = graph.parentToChildren;
    const childToParents = graph.childToParents;

    const nodesMap = new Map<string, FolderNode>();

    // Create all possible nodes using the shared helper
    allFilePaths.forEach(path => {
        const node = createFolderNode(app, path, graph);
        if (node) {
            nodesMap.set(path, node);
        }
    });

    // We need to re-identify hidden status because createFolderNode only sets it for HIDDEN_FOLDER_ID
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
                // Determine if we should add this child (handling hidden logic)
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
