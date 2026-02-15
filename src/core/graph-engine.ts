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
}

/**
 * Internal interface to track relationships defined by a specific file.
 * This allows for "Reference Counting" style logic where an edge exists
 * if EITHER the parent claims the child OR the child claims the parent.
 */
interface FileDefinedRelationships {
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
 * Public API Surface for the GraphEngine
 */
export interface IGraphEngine {
    // Queries
    getChildren(id: FileID): FileID[]; // Returns sorted list
    getParents(id: FileID): FileID[];
    getNodeMeta(id: FileID): NodeMeta | undefined;
    
    // Analysis
    getAllRoots(): FileID[]; // Nodes with parents.size === 0
    
    // Lifecycle
    initialize(): Promise<void>;
    forceReindex(): Promise<void>; // For "Refresh" button
    suspend(): void; // For "Batch Transaction" mode
    resume(): void;

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
     * Adds a directed edge from Parent -> Child
     */
    addEdge(parentId: FileID, childId: FileID): void {
        Logger.debug(`[Abstract Folder] AdjacencyIndex: Adding Edge ${parentId} -> ${childId}`);
        const parent = this.addNode(parentId);
        const child = this.addNode(childId);

        parent.children.add(childId);
        child.parents.add(parentId);
        
        // Update orphan status
        child.meta.isOrphan = child.parents.size === 0;
        Logger.debug(`[Abstract Folder] AdjacencyIndex: Edge confirmed ${parentId} -> ${childId}. Parent children: ${parent.children.size}, Child parents: ${child.parents.size}`);
    }

    /**
     * Removes a directed edge from Parent -> Child
     */
    removeEdge(parentId: FileID, childId: FileID): void {
        const parent = this.nodes.get(parentId);
        const child = this.nodes.get(childId);

        if (parent) {
            parent.children.delete(childId);
        }
        if (child) {
            child.parents.delete(parentId);
            // Update orphan status for child
            child.meta.isOrphan = child.parents.size === 0;
        }
    }

    /**
     * Removes a node and cleans up all connected edges
     */
    removeNode(id: FileID): void {
        const node = this.nodes.get(id);
        if (!node) return;

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
    private isSuspended: boolean = false;
    
    // Relationship Tracking
    private fileRelationships: Map<FileID, FileDefinedRelationships> = new Map();
    
    // Processing Queue
    private debouncedProcessQueue: Debouncer<[], void>;

    // Cached Property Names
    private parentProperties: string[] = [];
    private childProperties: string[] = [];

    constructor(app: App, settings: AbstractFolderPluginSettings) {
        this.app = app;
        this.settings = settings;
        this.index = new AdjacencyIndex();
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
        this.registerEvents();
        await this.forceReindex();
        Logger.info("GraphEngine initialized");
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
        const children = Array.from(node.children).sort();
        if (children.length > 0) {
            Logger.debug(`[Abstract Folder] GraphEngine: getChildren(${id}) -> [${children.join(', ')}]`);
        }
        return children;
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
     * Returns all nodes that have no parents (roots of the graph)
     */
    getAllRoots(): FileID[] {
        const roots: FileID[] = [];
        for (const id of this.index.getAllFileIds()) {
            const node = this.index.getNode(id);
            // A root MUST have zero parents.
            if (node && node.parents.size === 0) {
                roots.push(id);
            }
        }
        Logger.debug(`[Abstract Folder] GraphEngine: getAllRoots found ${roots.length} roots out of ${Array.from(this.index.getAllFileIds()).length} nodes`);
        return roots.sort();
    }

    /**
     * Forces a full re-index of the vault.
     * Useful for "Refresh" functionality or initial load.
     */
    async forceReindex(): Promise<void> {
        if (this.isSuspended) return;
        
        this.index.clear();
        this.fileRelationships.clear();

        const allFiles = this.app.vault.getFiles();
        for (const file of allFiles) {
            this.index.markDirty(file.path);
        }
        
        // Immediate process or debounce?
        // For forceReindex, we probably want to just run it.
        await this.processQueue();
    }

    /**
     * Suspends graph updates. Used for batch operations.
     */
    suspend(): void {
        this.isSuspended = true;
    }

    /**
     * Resumes graph updates and processes any queued changes.
     */
    resume(): void {
        this.isSuspended = false;
        this.debouncedProcessQueue();
    }

    getDiagnosticDump(): GraphDiagnosticDump {
        return this.index.dump();
    }

    // =========================================================================================
    // Internal Processing Logic
    // =========================================================================================

    private async processQueue() {
        if (this.isSuspended) return;

        const dirtyFiles = this.index.flushDirtyQueue();
        if (dirtyFiles.size === 0) return;

        Logger.debug(`[Abstract Folder] GraphEngine: Processing ${dirtyFiles.size} dirty files...`);

        for (const id of dirtyFiles) {
            const file = this.app.vault.getAbstractFileByPath(id);
            if (file instanceof TFile) {
                this.updateFileIncremental(file);
            } else {
                // File no longer exists, ensure it's removed
                this.removeFileFromGraph(id);
            }
        }
        
        // TODO: Notify listeners that graph updated
        // this.trigger('graph-updated');
    }

    private updateFileIncremental(file: TFile) {
        if (this.isExcluded(file.path)) return;

        Logger.debug(`[Abstract Folder] GraphEngine: Incremental update for ${file.path}`);
        const oldRelationships = this.fileRelationships.get(file.path) || { definedParents: new Set(), definedChildren: new Set() };
        const newRelationships = this.getFileRelationships(file);
        
        // Update Source of Truth
        this.fileRelationships.set(file.path, newRelationships);

        // 1. Handle Removed Relationships
        for (const parent of oldRelationships.definedParents) {
            if (!newRelationships.definedParents.has(parent)) {
                this.removeEdgeIfUnsupported(parent, file.path);
            }
        }
        for (const child of oldRelationships.definedChildren) {
            if (!newRelationships.definedChildren.has(child)) {
                this.removeEdgeIfUnsupported(file.path, child);
            }
        }

        // 2. Handle Added Relationships
        for (const parent of newRelationships.definedParents) {
            this.index.addEdge(parent, file.path);
            Logger.debug(`GraphEngine: Added edge ${parent} -> ${file.path}`);
        }
        for (const child of newRelationships.definedChildren) {
            this.index.addEdge(file.path, child);
            Logger.debug(`GraphEngine: Added edge ${file.path} -> ${child}`);
        }

        const existingNode = this.index.getNode(file.path);
        this.index.addNode(file.path, {
            mtime: file.stat.mtime,
            extension: file.extension,
            isOrphan: existingNode ? existingNode.parents.size === 0 : true
        });
    }

    private removeEdgeIfUnsupported(parent: FileID, child: FileID) {
        const parentDefs = this.fileRelationships.get(parent);
        const childDefs = this.fileRelationships.get(child);

        const definedByParent = parentDefs?.definedChildren.has(child);
        const definedByChild = childDefs?.definedParents.has(parent);

        if (!definedByParent && !definedByChild) {
            this.index.removeEdge(parent, child);
            Logger.debug(`GraphEngine: Removed edge ${parent} -> ${child}`);
        }
    }

    private removeFileFromGraph(id: FileID) {
        Logger.debug(`GraphEngine: Removing node ${id}`);
        this.fileRelationships.delete(id);
        this.index.removeNode(id);
        
        // We also need to check neighbors to see if any edges should be removed
        // (This is implicitly handled by removeNode which cleans up adjacency lists,
        // but we might want to re-verify remaining neighbors in a stricter system.
        // For now, index.removeNode is sufficient for topology, but we should clear definitions.)
    }

    private handleRename(file: TFile, oldPath: string) {
        // 1. Remove old ID
        this.removeFileFromGraph(oldPath);
        // 2. Add new ID (will be picked up by metadataCache usually, but we force it)
        this.index.markDirty(file.path);
        this.debouncedProcessQueue();
    }

    private getFileRelationships(file: TFile): FileDefinedRelationships {
        const relationships: FileDefinedRelationships = {
            definedParents: new Set(),
            definedChildren: new Set()
        };

        const metadata = this.app.metadataCache.getFileCache(file);
        if (!metadata?.frontmatter) return relationships;

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
                        }
                    }

                    // Child Definitions
                    if (this.childProperties.includes(baseKey)) {
                        if (resolvedPath !== file.path) {
                            relationships.definedChildren.add(resolvedPath);
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
