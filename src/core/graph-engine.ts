import { App, TFile, debounce, Debouncer, TAbstractFile } from 'obsidian';
import { AbstractFolderPluginSettings } from '../settings';
import { HIDDEN_FOLDER_ID } from '../types';
import { Logger } from '../utils/logger';

/**
 * Unique Identifier for a node is its File Path (e.g., "Folder/Note.md")
 */
export type FileID = string;

/**
 * Metadata cached to avoid TFile lookups during render
 */
export interface NodeMeta {
    extension: string;  // "md", "canvas"
    mtime: number;      // For sorting/invalidation
    isOrphan: boolean;  // True if no parents
    icon?: string;      // Custom icon from frontmatter
    isLibrary?: boolean;
    isShared?: boolean;
    isBackup?: boolean;
}

/**
 * Internal interface to track relationships defined by a specific file.
 * This allows for "Reference Counting" style logic where an edge exists
 * if EITHER the parent claims the child OR the child claims the parent.
 */
export interface FileDefinedRelationships {
    definedParents: Set<FileID>;
    definedChildren: Set<FileID>;
}

/**
 * Represents a single node in the graph
 */
export interface GraphNode {
    id: FileID;
    
    // Topology (Sets for O(1) lookups)
    // "Who considers me a child?" (Incoming Edges)
    parents: Set<FileID>;
    
    // "Who do I consider a child?" (Outgoing Edges)
    children: Set<FileID>;

    // Metadata
    meta: NodeMeta;
}

/**
 * Diagnostic snapshot of the graph for comparison and debugging
 */
export interface GraphDiagnosticDump {
    [id: string]: {
        parents: string[];
        children: string[];
    };
}

/**
 * Policy for determining which files appear at the top level of the view.
 */
export interface RootSelectionPolicy {
    /**
     * Returns true if a file with no parents should be considered a root of the tree.
     */
    shouldIncludeOrphan(id: FileID, meta: NodeMeta, settings: AbstractFolderPluginSettings): boolean;
}

/**
 * Standard implementation that respects the 'hideNonMarkdownOrphans' setting.
 */
export class StandardRootPolicy implements RootSelectionPolicy {
    shouldIncludeOrphan(id: FileID, meta: NodeMeta, settings: AbstractFolderPluginSettings): boolean {
        // Markdown files are always eligible as automatic roots
        if (meta.extension.toLowerCase() === 'md') {
            return true;
        }

        // Non-markdown files are only roots if the user explicitly wants to see them
        return !settings.hideNonMarkdownOrphans;
    }
}

/**
 * Public API Surface for the GraphEngine
 */
export interface IGraphEngine {
    // Queries
    getChildren(id: FileID): FileID[]; // Returns unsorted list (TreeBuilder handles sorting)
    getParents(id: FileID): FileID[];
    getNodeMeta(id: FileID): NodeMeta | undefined;
    
    // Analysis
    getAllRoots(activeGroupId?: string | null, scopingPath?: string | null): FileID[];
    
    // Lifecycle
    initialize(): Promise<void>;
    forceReindex(): Promise<void>; // For "Refresh" button
    suspend(): void; // For "Batch Transaction" mode
    resume(): void;

    // Data Synchronization
    seedRelationships(relationships: Map<FileID, FileDefinedRelationships>): void;

    // Diagnostics
    getDiagnosticDump(): GraphDiagnosticDump;
}

/**
 * Internal storage for the Graph Topology
 */
export class AdjacencyIndex {
    // The Master Map: 50,000 nodes -> < 10MB RAM
    private nodes: Map<FileID, GraphNode> = new Map();
    
    // The "Dirty List" for Batch Processing
    // Stores IDs of files that have changed but haven't been re-indexed yet
    private dirtyQueue: Set<FileID> = new Set();

    /**
     * Checks if a node exists in the index
     */
    hasNode(id: FileID): boolean {
        return this.nodes.has(id);
    }

    /**
     * Retrieves a node from the index
     */
    getNode(id: FileID): GraphNode | undefined {
        return this.nodes.get(id);
    }

    /**
     * Adds or updates a node in the index.
     * If the node already exists, it returns the existing one.
     */
    addNode(id: FileID, meta?: Partial<NodeMeta>): GraphNode {
        let node = this.nodes.get(id);
        if (!node) {
            node = {
                id,
                parents: new Set(),
                children: new Set(),
                meta: {
                    extension: '',
                    mtime: 0,
                    isOrphan: true,
                    ...meta
                }
            };
            this.nodes.set(id, node);
        } else if (meta) {
            // Merge metadata but NEVER overwrite parents/children sets
            node.meta = { ...node.meta, ...meta };
            // Ensure orphan status stays in sync with parents set
            node.meta.isOrphan = node.parents.size === 0;
        }
        return node;
    }

    /**
     * Adds a directed edge from Parent -> Child.
     * @returns true if the edge was newly added, false if it already existed.
     */
    addEdge(parentId: FileID, childId: FileID): boolean {
        const parent = this.addNode(parentId);
        const child = this.addNode(childId);

        if (parent.children.has(childId) && child.parents.has(parentId)) {
            return false;
        }

        parent.children.add(childId);
        child.parents.add(parentId);
        
        // Update orphan status
        child.meta.isOrphan = child.parents.size === 0;
        Logger.debug(`[Abstract Folder] AdjacencyIndex: Edge confirmed ${parentId} -> ${childId}. Parent children: ${parent.children.size}, Child parents: ${child.parents.size}`);
        return true;
    }

    /**
     * Removes a directed edge from Parent -> Child
     * @returns true if the edge was actually removed, false if it didn't exist.
     */
    removeEdge(parentId: FileID, childId: FileID): boolean {
        const parent = this.nodes.get(parentId);
        const child = this.nodes.get(childId);

        let changed = false;
        if (parent && parent.children.has(childId)) {
            parent.children.delete(childId);
            changed = true;
        }
        if (child && child.parents.has(parentId)) {
            child.parents.delete(parentId);
            // Update orphan status for child
            child.meta.isOrphan = child.parents.size === 0;
            changed = true;
        }
        return changed;
    }

    /**
     * Removes a node and cleans up all connected edges
     * @returns true if the node was actually removed.
     */
    removeNode(id: FileID): boolean {
        const node = this.nodes.get(id);
        if (!node) return false;

        // Remove this node from all its parents' children lists
        for (const parentId of node.parents) {
            const parent = this.nodes.get(parentId);
            if (parent) {
                parent.children.delete(id);
            }
        }

        // Remove this node from all its children's parents lists
        for (const childId of node.children) {
            const child = this.nodes.get(childId);
            if (child) {
                child.parents.delete(id);
                // Check if child becomes an orphan
                child.meta.isOrphan = child.parents.size === 0;
            }
        }

        this.nodes.delete(id);
        this.dirtyQueue.delete(id);
        return true;
    }

    /**
     * Marks a file as needing re-indexing
     */
    markDirty(id: FileID): void {
        this.dirtyQueue.add(id);
    }

    /**
     * Clears the dirty queue and returns the items
     */
    flushDirtyQueue(): Set<FileID> {
        const queue = new Set(this.dirtyQueue);
        this.dirtyQueue.clear();
        return queue;
    }

    /**
     * Returns all file IDs currently in the index
     */
    getAllFileIds(): IterableIterator<FileID> {
        return this.nodes.keys();
    }

    /**
     * Clears the entire index
     */
    clear(): void {
        this.nodes.clear();
        this.dirtyQueue.clear();
    }

    /**
     * Internal diagnostic dump of the entire adjacency index
     */
    dump(): GraphDiagnosticDump {
        const dump: GraphDiagnosticDump = {};
        for (const [id, node] of this.nodes) {
            dump[id] = {
                parents: Array.from(node.parents).sort(),
                children: Array.from(node.children).sort()
            };
        }
        return dump;
    }
}

/**
 * The GraphEngine acts as the source of truth for the plugin.
 * It maintains a real-time, Bidirectional Adjacency Matrix of the vault's structure.
 */
export class GraphEngine implements IGraphEngine {
    private app: App;
    private settings: AbstractFolderPluginSettings;
    private index: AdjacencyIndex;
    private rootPolicy: RootSelectionPolicy;
    private isSuspended: boolean = false;
    private isProcessing: boolean = false;
    
    // Relationship Tracking
    private fileRelationships: Map<FileID, FileDefinedRelationships> = new Map();
    
    // Processing Queue
    private debouncedProcessQueue: Debouncer<[], void>;

    // Cached Property Names
    private parentProperties: string[] = [];
    private childProperties: string[] = [];

    constructor(app: App, settings: AbstractFolderPluginSettings, rootPolicy?: RootSelectionPolicy) {
        this.app = app;
        this.settings = settings;
        this.index = new AdjacencyIndex();
        this.rootPolicy = rootPolicy || new StandardRootPolicy();
        this.debouncedProcessQueue = debounce(() => this.processQueue(), 500, true);
        this.updatePropertyCache();
    }

    /**
     * Updates cached property names from settings
     */
    private updatePropertyCache() {
        const parentProps = new Set(this.settings.parentPropertyNames || []);
        if (this.settings.propertyName) parentProps.add(this.settings.propertyName);
        this.parentProperties = Array.from(parentProps);

        const childProps = new Set(this.settings.childrenPropertyNames || []);
        if (this.settings.childrenPropertyName) childProps.add(this.settings.childrenPropertyName);
        this.childProperties = Array.from(childProps);
    }

    /**
     * Initializes the GraphEngine.
     * This will perform an initial scan of the vault to build the graph.
     */
    async initialize(): Promise<void> {
        Logger.debug("[Abstract Folder] GraphEngine: Initializing (registering events)...");
        this.registerEvents();
        // Indexing is now explicitly triggered by main.ts during onLayoutReady
        Logger.info("[Abstract Folder] GraphEngine: Events registered");
    }

    private registerEvents() {
        // Metadata Changed
        this.app.metadataCache.on("changed", (file: TFile) => {
            this.index.markDirty(file.path);
            this.debouncedProcessQueue();
        });

        // File Delete
        this.app.vault.on("delete", (file: TAbstractFile) => {
             if (file instanceof TFile) {
                 this.removeFileFromGraph(file.path);
             }
        });

        // File Rename
        this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
             if (file instanceof TFile) {
                 this.handleRename(file, oldPath);
             }
        });
    }

    /**
     * Returns the children of a specific node
     */
    getChildren(id: FileID): FileID[] {
        const node = this.index.getNode(id);
        if (!node) {
            Logger.debug(`[Abstract Folder] GraphEngine: getChildren(${id}) - Node not found`);
            return [];
        }
        // Return raw list; TreeBuilder will sort them based on Context state
        return Array.from(node.children);
    }

    /**
     * Returns the parents of a specific node
     */
    getParents(id: FileID): FileID[] {
        const node = this.index.getNode(id);
        if (!node) return [];
        return Array.from(node.parents).sort();
    }

    /**
     * Returns the metadata for a specific node
     */
    getNodeMeta(id: FileID): NodeMeta | undefined {
        return this.index.getNode(id)?.meta;
    }

    /**
     * Returns all nodes that have no parents (roots of the graph) in the current context.
     * Supports both Group-based filtering and Path-based scoping.
     */
    getAllRoots(activeGroupId?: string | null, scopingPath?: string | null): FileID[] {
        const processedRoots = new Set<FileID>();
        Logger.debug(`[Abstract Folder] GraphEngine: getAllRoots called with activeGroupId: ${activeGroupId}, scopingPath: ${scopingPath}`);

        // 1. Resolve effective scoping path
        let effectiveScopingPath = scopingPath || null;
        let isGroupBased = false;
        let group: import('../types').Group | undefined;

        if (activeGroupId) {
            group = this.settings.groups.find(g => g.id === activeGroupId);
            if (group) {
                isGroupBased = true;
            } else {
                // If not a group, treat it as a scoping path (legacy/shelf behavior)
                if (!effectiveScopingPath) {
                    effectiveScopingPath = activeGroupId;
                }
            }
        }

        // 2. Resolve Roots
        if (isGroupBased && group) {
            // Group Mode: Roots are the defined parent folders
            Logger.info(`[Abstract Folder] GraphEngine: Resolving roots for group ${group.name}`);
            const scopePrefix = effectiveScopingPath ? (effectiveScopingPath.endsWith('/') ? effectiveScopingPath : effectiveScopingPath + '/') : null;

            for (const path of group.parentFolders) {
                const resolved = this.resolveGroupRoot(path);
                if (resolved) {
                    // Filter by scopingPath if provided
                    if (scopePrefix && resolved !== effectiveScopingPath && !resolved.startsWith(scopePrefix)) {
                        continue;
                    }
                    processedRoots.add(resolved);
                }
            }
            return Array.from(processedRoots);
        } else if (effectiveScopingPath) {
            // Scoped Path Mode (Library/Spaces): Find orphans within this path
            Logger.info(`[Abstract Folder] GraphEngine: Resolving scoped roots for path: ${effectiveScopingPath}`);
            const scopePrefix = effectiveScopingPath.endsWith('/') ? effectiveScopingPath : effectiveScopingPath + '/';

            for (const id of this.index.getAllFileIds()) {
                // Only consider files inside the scoped path (or the path itself if it's a file)
                if (id !== effectiveScopingPath && !id.startsWith(scopePrefix)) continue;

                const node = this.index.getNode(id);
                if (!node) continue;

                // Policy Check
                if (!this.rootPolicy.shouldIncludeOrphan(id, node.meta, this.settings)) continue;

                // Check for parents WITHIN the scope
                let hasScopedParent = false;
                for (const parentId of node.parents) {
                    if (parentId === effectiveScopingPath || parentId.startsWith(scopePrefix)) {
                        hasScopedParent = true;
                        break;
                    }
                }

                if (!hasScopedParent) {
                    processedRoots.add(id);
                }
            }
            return Array.from(processedRoots);
        }

        // Default Mode: Global Orphans
        const libraryPath = this.settings.librarySettings.librariesPath;
        const sharedSpacesRoot = this.settings.librarySettings.sharedSpacesRoot || "Abstract Spaces";

        for (const id of this.index.getAllFileIds()) {
            const node = this.index.getNode(id);
            if (node && node.parents.size === 0) {
                // Exclude libraries/spaces from global roots
                if (libraryPath && (id === libraryPath || id.startsWith(libraryPath + '/'))) continue;
                if (id === sharedSpacesRoot || id.startsWith(sharedSpacesRoot + '/')) continue;

                if (this.rootPolicy.shouldIncludeOrphan(id, node.meta, this.settings)) {
                    processedRoots.add(id);
                }
            }
        }
        return Array.from(processedRoots);
    }

    private resolveGroupRoot(includedPath: string): string | null {
        // Ported resolution logic from V1 tree-utils
        let targetPath = includedPath;
        let file = this.app.vault.getAbstractFileByPath(targetPath);

        if (!file) {
            const folderName = includedPath.split('/').pop();
            if (folderName) {
                const insideNotePath = `${includedPath}/${folderName}.md`;
                if (this.app.vault.getAbstractFileByPath(insideNotePath)) {
                    targetPath = insideNotePath;
                }
            }
        }

        if (!this.app.vault.getAbstractFileByPath(targetPath)) {
            if (!targetPath.endsWith('.md')) {
                const siblingNotePath = `${targetPath}.md`;
                if (this.app.vault.getAbstractFileByPath(siblingNotePath)) {
                    targetPath = siblingNotePath;
                }
            }
        }

        const exists = this.app.vault.getAbstractFileByPath(targetPath);
        return exists ? targetPath : null;
    }

    /**
     * Forces a full re-index of the vault.
     * Useful for "Refresh" functionality or initial load.
     */
    async forceReindex(): Promise<void> {
        Logger.debug("[Abstract Folder] GraphEngine: forceReindex started");
        if (this.isSuspended) return;
        
        this.index.clear();
        this.fileRelationships.clear();

        const allFiles = this.app.vault.getFiles();
        Logger.debug(`[Abstract Folder] GraphEngine: forceReindex found ${allFiles.length} files in vault`);
        
        for (const file of allFiles) {
            this.index.markDirty(file.path);
        }
        
        // Immediate process or debounce?
        // For forceReindex, we probably want to just run it.
        await this.processQueue();
        Logger.debug("[Abstract Folder] GraphEngine: forceReindex complete");
    }

    /**
     * Suspends graph updates. Used for batch operations.
     */
    suspend(): void {
        Logger.debug("[Abstract Folder] GraphEngine: Suspending updates");
        this.isSuspended = true;
    }

    /**
     * Resumes graph updates and processes any queued changes.
     */
    resume(): void {
        Logger.debug("[Abstract Folder] GraphEngine: Resuming updates");
        this.isSuspended = false;
        this.debouncedProcessQueue();
    }

    /**
     * Seeds the GraphEngine with pre-verified relationships.
     * Used by the LibraryBridge to provide data before Obsidian's indexer catches up.
     */
    seedRelationships(relationships: Map<FileID, FileDefinedRelationships>): void {
        Logger.debug(`[Abstract Folder] GraphEngine: Seeding ${relationships.size} relationships`);
        
        for (const [id, rels] of relationships) {
            // Update internal relationship store
            this.fileRelationships.set(id, rels);

            // Update Adjacency Index immediately
            const file = this.app.vault.getAbstractFileByPath(id);
            if (file instanceof TFile) {
                // Remove existing edges for this node to ensure clean state
                const existing = this.index.getNode(id);
                if (existing) {
                    for (const p of existing.parents) this.index.removeEdge(p, id);
                    for (const c of existing.children) this.index.removeEdge(id, c);
                }

                // Add new edges
                for (const p of rels.definedParents) this.index.addEdge(p, id);
                for (const c of rels.definedChildren) this.index.addEdge(id, c);

                // Update node metadata
                this.index.addNode(id, {
                    extension: file.extension,
                    mtime: file.stat.mtime,
                    isOrphan: rels.definedParents.size === 0,
                    icon: this.app.metadataCache.getFileCache(file)?.frontmatter?.icon as string | undefined,
                    isLibrary: this.isLibraryPath(id),
                    isShared: this.isSharedSpacePath(id),
                    isBackup: this.isPersonalBackupPath(id)
                });
            }
        }
        Logger.debug(`[Abstract Folder] GraphEngine: Seeding complete`);
    }

    private isLibraryPath(path: string): boolean {
        const libraryPath = this.settings.librarySettings?.librariesPath;
        return !!libraryPath && (path === libraryPath || path.startsWith(libraryPath + '/'));
    }

    private isSharedSpacePath(path: string): boolean {
        // Check if the path is a root shared space or inside one
        return (this.settings.librarySettings?.sharedSpaces || []).some(space => 
            path === space || path.startsWith(space + '/')
        );
    }

    private isPersonalBackupPath(path: string): boolean {
        // Check if the path is a root backup or inside one
        return (this.settings.librarySettings?.personalBackups || []).some(backup => 
            path === backup || path.startsWith(backup + '/')
        );
    }

    getDiagnosticDump(): GraphDiagnosticDump {
        return this.index.dump();
    }

    // =========================================================================================
    // Internal Processing Logic
    // =========================================================================================

    private async processQueue() {
        if (this.isSuspended || this.isProcessing) return;
        this.isProcessing = true;
        Logger.debug("[Abstract Folder] GraphEngine: Processing queue started");

        try {
            const dirtyFiles = this.index.flushDirtyQueue();
            if (dirtyFiles.size === 0) {
                Logger.debug("[Abstract Folder] GraphEngine: Processing queue finished, no dirty files");
                return;
            }

            Logger.debug(`[Abstract Folder] GraphEngine: Processing ${dirtyFiles.size} dirty files...`);

            let topologyChanged = false;
            for (const id of dirtyFiles) {
                const file = this.app.vault.getAbstractFileByPath(id);
                if (file instanceof TFile) {
                    if (this.updateFileIncremental(file)) {
                        topologyChanged = true;
                    }
                } else {
                    // File no longer exists, ensure it's removed
                    if (this.removeFileFromGraph(id)) {
                        topologyChanged = true;
                    }
                }
            }
            
            // Notify listeners that graph updated ONLY if structure changed
            if (topologyChanged) {
                // @ts-ignore: Custom event
                this.app.workspace.trigger('abstract-folder:graph-updated');
                Logger.debug("[Abstract Folder] GraphEngine: Graph topology changed, triggered 'abstract-folder:graph-updated'");
            }
        } finally {
            this.isProcessing = false;
            Logger.debug("[Abstract Folder] GraphEngine: Processing queue finished");
            
            // Check if more work was queued while we were processing
            if (this.index.flushDirtyQueue().size > 0) {
                Logger.debug("[Abstract Folder] GraphEngine: More dirty files found after processing, re-queuing");
                this.debouncedProcessQueue();
            }
        }
    }

    private updateFileIncremental(file: TFile): boolean {
        Logger.debug(`[Abstract Folder] GraphEngine: updateFileIncremental started for ${file.path}`);
        if (this.isExcluded(file.path)) {
            Logger.debug(`[Abstract Folder] GraphEngine: ${file.path} is excluded, skipping incremental update`);
            return false;
        }

        const oldRelationships = this.fileRelationships.get(file.path);
        const newRelationships = this.getFileRelationships(file);
        
        // Skip topology processing if relationships are identical
        if (oldRelationships && this.areRelationshipsEqual(oldRelationships, newRelationships)) {
            // Still update metadata (mtime/icon) but skip structure changes
            this.index.addNode(file.path, {
                mtime: file.stat.mtime,
                extension: file.extension,
                icon: this.app.metadataCache.getFileCache(file)?.frontmatter?.icon as string | undefined,
                isLibrary: this.isLibraryPath(file.path),
                isShared: this.isSharedSpacePath(file.path),
                isBackup: this.isPersonalBackupPath(file.path)
            });
            Logger.debug(`[Abstract Folder] GraphEngine: ${file.path} relationships unchanged, only metadata updated`);
            return false;
        }

        Logger.debug(`[Abstract Folder] GraphEngine: Incremental update for ${file.path}`);
        
        // Update Source of Truth
        this.fileRelationships.set(file.path, newRelationships);

        let changed = false;

        // 1. Handle Removed Relationships
        if (oldRelationships) {
            for (const parent of oldRelationships.definedParents) {
                if (!newRelationships.definedParents.has(parent)) {
                    if (this.removeEdgeIfUnsupported(parent, file.path)) changed = true;
                }
            }
            for (const child of oldRelationships.definedChildren) {
                if (!newRelationships.definedChildren.has(child)) {
                    if (this.removeEdgeIfUnsupported(file.path, child)) changed = true;
                }
            }
        }

        // 2. Handle Added Relationships
        for (const parent of newRelationships.definedParents) {
            if (this.index.addEdge(parent, file.path)) changed = true;
        }
        for (const child of newRelationships.definedChildren) {
            if (this.index.addEdge(file.path, child)) changed = true;
        }

        const existingNode = this.index.getNode(file.path);
        
        if (!existingNode) {
            changed = true;
        }

        this.index.addNode(file.path, {
            mtime: file.stat.mtime,
            extension: file.extension,
            isOrphan: existingNode ? existingNode.parents.size === 0 : true,
            icon: this.app.metadataCache.getFileCache(file)?.frontmatter?.icon as string | undefined,
            isLibrary: this.isLibraryPath(file.path),
            isShared: this.isSharedSpacePath(file.path),
            isBackup: this.isPersonalBackupPath(file.path)
        });
        Logger.debug(`[Abstract Folder] GraphEngine: updateFileIncremental finished for ${file.path}, changed: ${changed}`);
        return changed;
    }

    private areRelationshipsEqual(a: FileDefinedRelationships, b: FileDefinedRelationships): boolean {
        if (a.definedParents.size !== b.definedParents.size) return false;
        if (a.definedChildren.size !== b.definedChildren.size) return false;
        for (const p of a.definedParents) if (!b.definedParents.has(p)) return false;
        for (const c of a.definedChildren) if (!b.definedChildren.has(c)) return false;
        return true;
    }

    private removeEdgeIfUnsupported(parent: FileID, child: FileID): boolean {
        const parentDefs = this.fileRelationships.get(parent);
        const childDefs = this.fileRelationships.get(child);

        const definedByParent = parentDefs?.definedChildren.has(child);
        const definedByChild = childDefs?.definedParents.has(parent);

        if (!definedByParent && !definedByChild) {
            Logger.debug(`[Abstract Folder] GraphEngine: Removing edge ${parent} -> ${child} as no longer supported by definitions`);
            return this.index.removeEdge(parent, child);
        }
        return false;
    }

    private removeFileFromGraph(id: FileID): boolean {
        Logger.debug(`GraphEngine: Removing node ${id}`);
        this.fileRelationships.delete(id);
        const removed = this.index.removeNode(id);
        if (removed) {
            Logger.debug(`GraphEngine: Node ${id} successfully removed from graph`);
        } else {
            Logger.debug(`GraphEngine: Node ${id} was not found in graph for removal`);
        }
        return removed;
        
        // We also need to check neighbors to see if any edges should be removed
        // (This is implicitly handled by removeNode which cleans up adjacency lists,
        // but we might want to re-verify remaining neighbors in a stricter system.
        // For now, index.removeNode is sufficient for topology, but we should clear definitions.)
    }

    private handleRename(file: TFile, oldPath: string) {
        Logger.debug(`[Abstract Folder] GraphEngine: Handling rename from ${oldPath} to ${file.path}`);
        // 1. Remove old ID
        this.removeFileFromGraph(oldPath);
        // 2. Add new ID (will be picked up by metadataCache usually, but we force it)
        this.index.markDirty(file.path);
        this.debouncedProcessQueue();
        Logger.debug(`[Abstract Folder] GraphEngine: Rename handled, new path ${file.path} marked dirty`);
    }

    private getFileRelationships(file: TFile): FileDefinedRelationships {
        Logger.debug(`[Abstract Folder] GraphEngine: getFileRelationships started for ${file.path}`);
        const relationships: FileDefinedRelationships = {
            definedParents: new Set(),
            definedChildren: new Set()
        };

        const metadata = this.app.metadataCache.getFileCache(file);
        
        // CRITICAL DEBUG: Full metadata dump for Library files
        if (file.path.includes("Abstract Library")) {
            Logger.debug(`[Abstract Folder] GraphEngine: CRITICAL CACHE DUMP for ${file.path}`, {
                fullMetadata: metadata,
                rawFrontmatter: metadata?.frontmatter,
                fmLinks: metadata?.frontmatterLinks
            });
        }

        if (!metadata?.frontmatter) {
            Logger.debug(`[Abstract Folder] GraphEngine: No frontmatter found for ${file.path}`);
            return relationships;
        }

        let isHidden = false;

        // 1. Check for "hidden" status
        for (const propName of this.parentProperties) {
            const parentProperty = metadata.frontmatter[propName] as unknown;
            if (parentProperty) {
                const values = Array.isArray(parentProperty) ? parentProperty : [parentProperty];
                for (const val of values) {
                    if (typeof val === 'string' && val.toLowerCase().trim() === 'hidden') {
                        isHidden = true;
                        break;
                    }
                }
            }
            if (isHidden) break;
        }

        if (isHidden) {
            relationships.definedParents.add(HIDDEN_FOLDER_ID);
            Logger.debug(`[Abstract Folder] GraphEngine: ${file.path} marked as hidden`);
        }

        // 2. Process Frontmatter Links
        if (metadata.frontmatterLinks) {
            for (const link of metadata.frontmatterLinks) {
                const resolvedPath = this.resolveLink(link.link, file.path);
                const baseKey = link.key.split('.')[0];

                if (resolvedPath) {
                    // Parent Definitions
                    if (!isHidden && this.parentProperties.includes(baseKey)) {
                        if (resolvedPath !== file.path) {
                            relationships.definedParents.add(resolvedPath);
                            Logger.debug(`[Abstract Folder] GraphEngine: ${file.path} defines parent ${resolvedPath} via ${baseKey}`);
                        }
                    }

                    // Child Definitions
                    if (this.childProperties.includes(baseKey)) {
                        if (resolvedPath !== file.path) {
                            relationships.definedChildren.add(resolvedPath);
                            Logger.debug(`[Abstract Folder] GraphEngine: ${file.path} defines child ${resolvedPath} via ${baseKey}`);
                        }
                    }
                }
            }
        }
        
        Logger.debug(`[Abstract Folder] GraphEngine: Relationship for ${file.path}`, {
            parents: Array.from(relationships.definedParents),
            children: Array.from(relationships.definedChildren)
        });

        return relationships;
    }

    private resolveLink(link: string, sourcePath: string): string | null {
        // 1. Remove outer quotes (YAML string behavior)
        let cleaned = link.replace(/^["']+|["']+$|^\s+|[\s]+$/g, '');

        // Check for Markdown link [Alias](Path)
        const mdLinkMatch = cleaned.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
        if (mdLinkMatch) {
            // Decode URI component because Markdown links might be encoded (e.g. %20 for spaces)
            try {
                cleaned = decodeURI(mdLinkMatch[2]);
            } catch {
                cleaned = mdLinkMatch[2];
            }
        } else {
            // 2. Remove wiki-link brackets
            cleaned = cleaned.replace(/\[\[|\]\]/g, '');

            // 3. Handle Pipe aliases [[Link|Alias]] -> Link
            cleaned = cleaned.split('|')[0];
        }

        // 4. Trim again and remove internal quotes (e.g. [["Work"]])
        const cleanedTrimmed = cleaned.trim();
        const finalCleaned = cleanedTrimmed.replace(/^["']+|["']+$/g, '');

        if (!finalCleaned) return null;

        // 5. Resolve
        const resolved = this.app.metadataCache.getFirstLinkpathDest(finalCleaned, sourcePath);
        if (resolved) return resolved.path;

        // 6. Fallback: Check if it's a folder or existing abstract file
        const abstractFile = this.app.vault.getAbstractFileByPath(finalCleaned);
        if (abstractFile) return abstractFile.path;

        return null;
    }

    private isExcluded(path: string): boolean {
        if (!this.settings.excludedPaths) return false;
        for (const excluded of this.settings.excludedPaths) {
            if (path.startsWith(excluded)) return true;
        }
        return false;
    }
}
