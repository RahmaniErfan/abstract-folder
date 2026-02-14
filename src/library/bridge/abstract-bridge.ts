import { App, TFolder, TFile } from "obsidian";
import { LibraryNode, LibraryConfig } from "../types";
import { Logger } from "../../utils/logger";
import { FolderNode } from "../../types";
import { DataService } from "../services/data-service";
import { AbstractFolderPluginSettings } from "../../settings";

/**
 * AbstractBridge is responsible for merging physical library nodes
 * (synced via Git) into the plugin's file tree.
 */
export class AbstractBridge {
    private parentPropertyNames: string[] = ['parent'];

    constructor(private app: App, settings?: Partial<AbstractFolderPluginSettings>) {
        if (settings) {
            const names = new Set<string>();
            if (settings.parentPropertyNames) {
                settings.parentPropertyNames.forEach((name: string) => names.add(name));
            }
            if (settings.propertyName) {
                names.add(settings.propertyName);
            }
            if (names.size > 0) {
                this.parentPropertyNames = Array.from(names);
            }
        }
    }

    /**
     * Finds all library folders in the vault and converts them to LibraryNodes.
     */
    async discoverLibraries(basePath: string): Promise<LibraryNode[]> {
        try {
            const folder = this.app.vault.getAbstractFileByPath(basePath);
            if (!(folder instanceof TFolder)) return [];

            const libraries: LibraryNode[] = [];
            
            // Check if the current folder is a library
            const config = await this.getLibraryConfig(folder.path);
            if (config) {
                libraries.push({
                    file: folder,
                    path: folder.path,
                    isFolder: true,
                    isLibrary: true,
                    libraryId: config.id,
                    registryId: "default",
                    isPublic: true,
                    status: 'up-to-date',
                    isLocked: true,
                    children: await this.buildAbstractLibraryTree(folder)
                });
            } else {
                // Scan subfolders for libraries
                for (const child of folder.children) {
                    if (child instanceof TFolder) {
                        const subLibraries = await this.discoverLibraries(child.path);
                        libraries.push(...subLibraries);
                    }
                }
            }

            return libraries;
        } catch (error) {
            console.error("Failed to discover libraries", error);
            return [];
        }
    }

    /**
     * Helper to read library.config.json from the vault.
     */
    private async getLibraryConfig(dir: string): Promise<LibraryConfig | null> {
        const configPath = `${dir}/library.config.json`;
        const file = this.app.vault.getAbstractFileByPath(configPath);
        if (file instanceof TFile) {
            try {
                const content = await this.app.vault.read(file);
                return DataService.parseLibraryConfig(content);
            } catch (e) {
                console.error(`[AbstractBridge] Invalid library manifest at ${configPath}:`, e);
            }
        }
        return null;
    }

    /**
     * Maps library files to an abstract hierarchy based on metadata.
     * This follows the core philosophy: physical folders are flattened,
     * and structure is derived purely from parent-child relationships.
     */
    async buildAbstractLibraryTree(libraryRoot: TFolder): Promise<FolderNode[]> {
        const files: TFile[] = [];
        const localPathMap = new Map<string, string>(); // basename/name -> path

        const recursiveScan = (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    if (child.name === ".git" || child.name === "node_modules") continue;
                    recursiveScan(child);
                } else if (child instanceof TFile && child.extension === 'md' && child.name !== 'library.config.json') {
                    files.push(child);
                    localPathMap.set(child.basename, child.path);
                    localPathMap.set(child.name, child.path);
                }
            }
        };
        recursiveScan(libraryRoot);

        const parentToChildren: Record<string, Set<string>> = {};
        const childToParents: Record<string, Set<string>> = {};
        const allPaths = new Set<string>();

        Logger.debug(`[AbstractBridge] Scanning ${files.length} markdown files in library:`, files.map(f => f.path));

        // Build relationships
        for (const file of files) {
            allPaths.add(file.path);
            
            // Abstract Philosophy: In libraries, we might need to parse the file content
            // if the metadata cache is not yet ready (common after git clone/pull)
            let cache = this.app.metadataCache.getFileCache(file);
            let frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;

            // Fallback: If cache is empty OR doesn't contain our parent properties, try reading directly
            const hasParentProp = frontmatter && this.parentPropertyNames.some(prop => frontmatter![prop]);
            const hasChildrenProp = frontmatter && frontmatter['children'];

            if (!frontmatter || (!hasParentProp && !hasChildrenProp)) {
                try {
                    const content = await this.app.vault.read(file);
                    const fmMatch = content.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/);
                    if (fmMatch) {
                        // Very basic YAML parser for 'parent' and 'children'
                        const fmContent = fmMatch[1];
                        const lines = fmContent.split('\n');
                        const manualFM: Record<string, unknown> = {};
                        for (const line of lines) {
                            const [key, ...valParts] = line.split(':');
                            if (key && valParts.length > 0) {
                                const k = key.trim();
                                if (this.parentPropertyNames.includes(k) || k === 'children') {
                                    const v = valParts.join(':').trim();
                                    // Handle simple arrays [a, b] or strings
                                    if (v.startsWith('[') && v.endsWith(']')) {
                                        manualFM[k] = v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
                                    } else {
                                        manualFM[k] = v.replace(/^["']|["']$/g, '');
                                    }
                                }
                            }
                        }
                        frontmatter = manualFM;
                        Logger.debug(`[AbstractBridge] Parsed manual frontmatter for ${file.name}:`, frontmatter);
                    }
                } catch (e) {
                    Logger.error(`[AbstractBridge] Failed to read ${file.path} for manual metadata:`, e);
                }
            }
            
            // Check all configured parent properties
            for (const propName of this.parentPropertyNames) {
                let parentValue: unknown = frontmatter ? frontmatter[propName] : null;

                if (parentValue) {
                    Logger.debug(`[AbstractBridge] Found parent property "${propName}" in ${file.name}:`, parentValue);
                    const parentLinks = Array.isArray(parentValue) ? parentValue as unknown[] : [parentValue];
                    for (const link of parentLinks) {
                        if (typeof link !== 'string') continue;
                        
                        const parentPath = this.resolveLibraryLink(link, file.path, libraryRoot.path, localPathMap);
                        if (parentPath && parentPath !== file.path) {
                            Logger.debug(`[AbstractBridge] Resolved link "${link}" to ${parentPath}`);
                            if (!parentToChildren[parentPath]) parentToChildren[parentPath] = new Set();
                            parentToChildren[parentPath].add(file.path);

                            if (!childToParents[file.path]) childToParents[file.path] = new Set();
                            childToParents[file.path].add(parentPath);
                        } else {
                            Logger.debug(`[AbstractBridge] Failed to resolve link "${link}" in ${file.path}`);
                        }
                    }
                }
            }

            // Also check 'children' property (inverted relationship)
            const childrenValue = frontmatter?.['children'];
            if (childrenValue) {
                Logger.debug(`[AbstractBridge] Found children property in ${file.name}:`, childrenValue);
                const childLinks = Array.isArray(childrenValue) ? childrenValue as unknown[] : [childrenValue];
                for (const link of childLinks) {
                    if (typeof link !== 'string') continue;
                    const childPath = this.resolveLibraryLink(link, file.path, libraryRoot.path, localPathMap);
                    if (childPath && childPath !== file.path) {
                        Logger.debug(`[AbstractBridge] Resolved child link "${link}" to ${childPath}`);
                        if (!parentToChildren[file.path]) parentToChildren[file.path] = new Set();
                        parentToChildren[file.path].add(childPath);

                        if (!childToParents[childPath]) childToParents[childPath] = new Set();
                        childToParents[childPath].add(file.path);
                    }
                }
            }
        }

        // Identify roots (files in this library that have no parent within the library)
        const roots: FolderNode[] = [];
        for (const path of allPaths) {
            if (!childToParents[path] || childToParents[path].size === 0) {
                const node = this.createAbstractNode(path, parentToChildren);
                if (node) roots.push(node);
            }
        }

        Logger.debug(`[AbstractBridge] Tree building complete. Roots count: ${roots.length}`, roots.map(r => r.path));
        return roots;
    }

    private resolveLibraryLink(link: string, sourcePath: string, libraryBasePath: string, localPathMap?: Map<string, string>): string | null {
        // Clean wiki links
        let cleaned = link.replace(/\[\[|\]\]/g, '').split('|')[0].trim();
        const cleanedNoExt = cleaned.replace(/\.md$/, '');

        // 1. Try localPathMap first (Proactive)
        if (localPathMap) {
            const localMatch = localPathMap.get(cleaned) || localPathMap.get(cleanedNoExt);
            if (localMatch) return localMatch;
        }
        
        // 2. Try resolving via metadata cache (Reactive)
        const resolved = this.app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath);
        if (resolved && resolved.path.startsWith(libraryBasePath)) {
            return resolved.path;
        }

        // 3. Fallback: try direct path resolution relative to library root
        const allFiles = this.app.vault.getMarkdownFiles();
        const libraryFiles = allFiles.filter(f => f.path.startsWith(libraryBasePath));
        
        const match = libraryFiles.find(f =>
            f.basename === cleaned ||
            f.basename === cleanedNoExt ||
            f.path === cleaned ||
            f.name === cleaned ||
            f.name === cleaned + ".md"
        );

        if (match) return match.path;

        return null;
    }

    private createAbstractNode(path: string, parentToChildren: Record<string, Set<string>>): FolderNode | null {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;

        const childrenPaths = parentToChildren[path];
        const childrenNodes: FolderNode[] = [];
        if (childrenPaths) {
            for (const childPath of childrenPaths) {
                const childNode = this.createAbstractNode(childPath, parentToChildren);
                if (childNode) childrenNodes.push(childNode);
            }
        }

        return {
            file,
            path,
            isFolder: childrenNodes.length > 0, // In Abstract philosophy, files act as folders if they have children
            children: childrenNodes,
            isLibrary: true // Flag as library node for read-only UI
        };
    }

    /**
     * Injects libraries into the main tree structure.
     */
    injectLibraries(tree: FolderNode[], libraries: LibraryNode[]): FolderNode[] {
        // This is where we hook into the VirtualTreeManager's render logic
        // We add the libraries as top-level roots or under a specific group
        
        // Ensure libraries are sorted or unique if needed
        const libraryPaths = new Set(libraries.map(l => l.path));
        const filteredTree = tree.filter(node => !libraryPaths.has(node.path));
        
        return [...filteredTree, ...libraries];
    }

    /**
     * Gets the relative path within a library for a given virtual path.
     */
    getRelativePath(fullPath: string, libraryPath: string): string {
        if (!fullPath.startsWith(libraryPath)) return fullPath;
        return fullPath.substring(libraryPath.length).replace(/^\/+/, '');
    }
}
