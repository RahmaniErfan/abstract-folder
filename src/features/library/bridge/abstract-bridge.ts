import { App, TFolder, TFile } from "obsidian";
import { LibraryNode, LibraryConfig } from "../types";
import { Logger } from "../../../utils/logger";
import { FolderNode, FileID } from "../../../types";
import { DataService } from "../services/data-service";
import { AbstractFolderPluginSettings } from "../../../settings";
import { FileDefinedRelationships } from "../../../core/graph-engine";
import { ConfigResolver, ResolvedProperties } from "../services/config-resolver";

/**
 * AbstractBridge is responsible for merging physical library nodes
 * (synced via Git) into the plugin's file tree.
 */
export class AbstractBridge {
    private parentPropertyNames: string[] = ['parent'];
    private childrenPropertyNames: string[] = ['children'];
    private configResolver: ConfigResolver;
    
    // Cache for discovered libraries
    private discoveryCache: LibraryNode[] | null = null;
    private lastDiscoveryTime: number = 0;
    private DISCOVERY_TTL = 5000; // 5 seconds cache for discovery

    // Cache for built trees per library
    private treeCache: Map<string, { nodes: FolderNode[], relationships: Map<FileID, FileDefinedRelationships>, timestamp: number }> = new Map();

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
            if (settings.childrenPropertyNames) {
                this.childrenPropertyNames = settings.childrenPropertyNames;
            } else if (settings.childrenPropertyName) {
                this.childrenPropertyNames = [settings.childrenPropertyName];
            }
        }
        this.configResolver = new ConfigResolver(this.app, (settings as AbstractFolderPluginSettings) || {});
    }

    /**
     * Finds all library folders in the vault and converts them to LibraryNodes.
     */
    async discoverLibraries(basePath: string, forceRefresh = false): Promise<LibraryNode[]> {
        const now = Date.now();
        if (!forceRefresh && this.discoveryCache && (now - this.lastDiscoveryTime < this.DISCOVERY_TTL)) {
            return this.discoveryCache;
        }

        Logger.debug(`AbstractBridge: discoverLibraries called for: ${basePath}`);
        try {
            let folder = this.app.vault.getAbstractFileByPath(basePath);
            
            // If forceRefresh is on, we skip the cache and go straight to the adapter
            // to avoid Obsidian index lag during library install/sync.
            if (forceRefresh) {
                const list = await this.app.vault.adapter.list(basePath);
                const libraries: LibraryNode[] = [];
                
                // Check if the current folder is a library by looking for library.json directly on disk
                const config = await this.getLibraryConfig(basePath);
                if (config) {
                    const libFolder = folder instanceof TFolder ? folder : (await this.app.vault.adapter.list(basePath), this.app.vault.getAbstractFileByPath(basePath)) as TFolder;
                    if (libFolder) {
                        libraries.push({
                            file: libFolder,
                            path: libFolder.path,
                            isFolder: true,
                            isLibrary: true,
                            libraryId: config.id,
                            catalogId: "default",
                            isPublic: true,
                            status: 'up-to-date',
                            isLocked: true,
                            children: await this.buildAbstractLibraryTree(libFolder, true)
                        });
                    }
                } else {
                    // Direct disk scan for sub-libraries
                    for (const subDir of list.folders) {
                        const name = subDir.split('/').pop();
                        if (name === ".git" || name === "node_modules" || name === ".abstract") continue;
                        const subLibraries = await this.discoverLibraries(subDir, true);
                        libraries.push(...subLibraries);
                    }
                }
                
                this.discoveryCache = libraries;
                this.lastDiscoveryTime = now;
                return libraries;
            }

            // Normal cached flow
            if (!(folder instanceof TFolder)) return [];
            const libraries: LibraryNode[] = [];
            const config = await this.getLibraryConfig(folder.path);
            if (config) {
                libraries.push({
                    file: folder,
                    path: folder.path,
                    isFolder: true,
                    isLibrary: true,
                    libraryId: config.id,
                    catalogId: "default",
                    isPublic: true,
                    status: 'up-to-date',
                    isLocked: true,
                    children: await this.buildAbstractLibraryTree(folder)
                });
            } else {
                for (const child of folder.children) {
                    if (child instanceof TFolder) {
                        if (child.name === ".git" || child.name === "node_modules" || child.name === ".abstract") continue;
                        const subLibraries = await this.discoverLibraries(child.path, false);
                        libraries.push(...subLibraries);
                    }
                }
            }

            this.discoveryCache = libraries;
            this.lastDiscoveryTime = now;
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
        // 1. Try Obsidian file cache first (fastest)
        const pathsToTry = [`${dir}/.abstract/library.json`, `${dir}/library.json` ];
        
        for (const configPath of pathsToTry) {
            const file = this.app.vault.getAbstractFileByPath(configPath);
            if (file instanceof TFile) {
                try {
                    const content = await this.app.vault.read(file);
                    return DataService.parseLibraryConfig(content);
                } catch (e) {
                    // Potential parse error
                }
            }
        }

        // 2. Fallback to adapter.read (direct disk)
        for (const configPath of pathsToTry) {
            try {
                const exists = await this.app.vault.adapter.exists(configPath);
                if (exists) {
                    const content = await this.app.vault.adapter.read(configPath);
                    return DataService.parseLibraryConfig(content);
                }
            } catch (e) {
                // Not a library or file locked
            }
        }
        
        return null;
    }

    /**
     * Physical folders are flattened, and structure is derived from parent-child relationships.
     */
    async buildAbstractLibraryTree(libraryRoot: TFolder, forceRefresh = false): Promise<FolderNode[]> {
        const cacheKey = libraryRoot.path;
        const now = Date.now();
        const cached = this.treeCache.get(cacheKey);
        
        if (!forceRefresh && cached && (now - cached.timestamp < 30000)) { // 30s cache for tree
            return cached.nodes;
        }

        Logger.debug(`AbstractBridge: buildAbstractLibraryTree called for root: ${libraryRoot.path}`);
        
        this.configResolver.clearCache();

        const files: TFile[] = [];
        const localPathMap = new Map<string, string>(); // basename/name -> path

        const recursiveScan = async (dirPath: string) => {
            const list = await this.app.vault.adapter.list(dirPath);
            
            // Files
            for (const filePath of list.files) {
                if (filePath.endsWith(".md")) {
                    const file = this.app.vault.getAbstractFileByPath(filePath);
                    if (file instanceof TFile && file.name !== 'library.json' && file.name !== 'manifest.json') {
                        files.push(file);
                        localPathMap.set(file.basename, file.path);
                        localPathMap.set(file.name, file.path);
                    } else if (!file && filePath.endsWith(".md")) {
                        // Even if not in vault (un-indexed), we can still track the path if we have to
                        // but buildAbstractLibraryTree currently depends on TFile.
                    }
                }
            }

            // Folders
            for (const subDir of list.folders) {
                const name = subDir.split('/').pop();
                if (name === ".git" || name === "node_modules" || name === ".abstract") continue;
                await recursiveScan(subDir);
            }
        };
        await recursiveScan(libraryRoot.path);

        const parentToChildren: Record<string, Set<string>> = {};
        const childToParents: Record<string, Set<string>> = {};
        const allPaths = new Set<string>();

        // Logger.debug(`AbstractBridge: Scanning ${files.length} markdown files in library`);

        // Build relationships
        for (const file of files) {
            allPaths.add(file.path);
            
            const resolvedProps = await this.configResolver.getProperties(file.path);
            const currentParentProps = resolvedProps.parentPropertyNames;
            const currentChildrenProps = resolvedProps.childrenPropertyNames;

            // If cache is not ready, parse file content directly
            const cache = this.app.metadataCache.getFileCache(file);
            let frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;

            const hasParentProp = frontmatter && currentParentProps.some(prop => frontmatter![prop]);
            const hasChildrenProp = frontmatter && currentChildrenProps.some(prop => frontmatter![prop]);

            if (!frontmatter || (!hasParentProp && !hasChildrenProp)) {
                try {
                    const content = await this.app.vault.read(file);
                    // More lenient regex for frontmatter detection
                    const fmMatch = content.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/m);
                    if (fmMatch) {
                        const fmContent = fmMatch[1];
                        const lines = fmContent.split('\n');
                        const manualFM: Record<string, unknown> = {};
                        
                        for (const line of lines) {
                            if (!line.includes(':')) continue;
                            const [key, ...valParts] = line.split(':');
                            const k = key.trim();
                            const val = valParts.join(':').trim();
                            
                            // Check if this key matches any of our parent/children property names (case-insensitive)
                            const isParentKey = currentParentProps.some(p => p.toLowerCase() === k.toLowerCase());
                            const isChildrenKey = currentChildrenProps.some(p => p.toLowerCase() === k.toLowerCase());

                            if (isParentKey || isChildrenKey) {
                                let v = val;
                                // Clean quotes and wiki-link brackets
                                v = v.replace(/^["']|["']$/g, '');
                                
                                if (v.startsWith('[') && v.endsWith(']')) {
                                    manualFM[k] = v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '').replace(/^\[\[|\]\]$/g, ''));
                                } else {
                                    manualFM[k] = v.replace(/^\[\[|\]\]$/g, '');
                                }
                                // Logger.debug(`[AbstractBridge] Extracted ${k}:`, manualFM[k]);
                            }
                        }
                        frontmatter = manualFM;
                        Logger.debug(`[AbstractBridge] Manual parse of ${file.name}:`, { frontmatter, checkedProperties: currentParentProps });
                    }
                } catch (e) {
                    Logger.error(`[AbstractBridge] Failed to read ${file.path} for manual metadata:`, e);
                }
            }
            
            // Check all configured parent properties
            for (const propName of currentParentProps) {
                let parentValue: unknown = frontmatter ? frontmatter[propName] : null;

                if (parentValue) {
                    // Logger.debug(`AbstractBridge: Found parent property "${propName}" in ${file.name}:`, parentValue);
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
                            // Logger.debug(`AbstractBridge: Failed to resolve link "${link}" in ${file.path}`);
                        }
                    }
                }
            }

            // Process children property (inverted relationship)
            for (const propName of currentChildrenProps) {
                const childrenValue = frontmatter?.[propName];
                if (childrenValue) {
                    // Logger.debug(`AbstractBridge: Found children property in ${file.name}:`, childrenValue);
                    const childLinks = Array.isArray(childrenValue) ? childrenValue as unknown[] : [childrenValue];
                    for (const link of childLinks) {
                        if (typeof link !== 'string') continue;
                        const childPath = this.resolveLibraryLink(link, file.path, libraryRoot.path, localPathMap);
                        if (childPath && childPath !== file.path) {
                            // Logger.debug(`AbstractBridge: Resolved child link "${link}" to ${childPath}`);
                            if (!parentToChildren[file.path]) parentToChildren[file.path] = new Set();
                            parentToChildren[file.path].add(childPath);

                            if (!childToParents[childPath]) childToParents[childPath] = new Set();
                            childToParents[childPath].add(file.path);
                        }
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

        // Logger.debug(`AbstractBridge: Tree building complete. Roots count: ${roots.length}`);
        
        // Prepare the flat relationship map for seeding the GraphEngine
        const relationshipMap = new Map<FileID, FileDefinedRelationships>();
        for (const path of allPaths) {
            relationshipMap.set(path, {
                definedParents: childToParents[path] || new Set(),
                definedChildren: parentToChildren[path] || new Set()
            });
        }

        this.treeCache.set(cacheKey, {
            nodes: roots,
            relationships: relationshipMap,
            timestamp: now
        });
        return roots;
    }

    /**
     * Returns the relationships for a specific library, if cached.
     */
    getLibraryRelationships(libraryRootPath: string): Map<FileID, FileDefinedRelationships> | null {
        return this.treeCache.get(libraryRootPath)?.relationships || null;
    }

    /**
     * Invalidates all caches
     */
    invalidateCache() {
        this.discoveryCache = null;
        this.treeCache.clear();
    }

    private resolveLibraryLink(link: string, sourcePath: string, libraryBasePath: string, localPathMap?: Map<string, string>): string | null {
        // Clean wiki links
        let cleaned = link.replace(/\[\[|\]\]/g, '').split('|')[0].trim();
        const cleanedNoExt = cleaned.replace(/\.md$/, '');

        // Check localPathMap
        if (localPathMap) {
            const localMatch = localPathMap.get(cleaned) || localPathMap.get(cleanedNoExt);
            if (localMatch) return localMatch;
        }
        
        // Resolve via metadata cache
        const resolved = this.app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath);
        if (resolved && resolved.path.startsWith(libraryBasePath)) {
            return resolved.path;
        }

        // Direct path resolution relative to library root
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

    private createAbstractNode(path: string, parentToChildren: Record<string, Set<string>>, visited = new Set<string>()): FolderNode | null {
        if (visited.has(path)) {
            Logger.warn(`[AbstractBridge] Cycle detected at ${path}`);
            return null;
        }

        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;

        const newVisited = new Set(visited);
        newVisited.add(path);

        const childrenPaths = parentToChildren[path];
        const childrenNodes: FolderNode[] = [];
        if (childrenPaths) {
            for (const childPath of childrenPaths) {
                const childNode = this.createAbstractNode(childPath, parentToChildren, newVisited);
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
        // Sync libraries with tree structure
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
