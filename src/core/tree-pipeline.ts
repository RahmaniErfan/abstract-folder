import { App, TFile, TFolder } from "obsidian";
import { FileID, IGraphEngine, NodeMeta } from "./graph-engine";
import { SortConfig } from "../types";
import { MetricsManager } from "../metrics-manager";
import { Logger } from "../utils/logger";

export interface TreePipeline {
    /**
     * Phase 1: Hard Filter.
     * Determines if a node is explicitly excluded (e.g., by extension).
     * Hard filters always take precedence over structural and search rules.
     */
    isExcluded(id: FileID, meta: NodeMeta | undefined): boolean;

    /**
     * Phase 2: Search/Query Match.
     * Determines if a node matches the active search query.
     */
    matches(id: FileID, meta: NodeMeta | undefined, parentId?: FileID): boolean;

    /**
     * Determines if a node is structural (e.g., a group root or an expanded parent)
     * and should remain visible even if it doesn't match the search.
     */
    isStructural(id: FileID): boolean;

    /**
     * Helper to check if a node directly matches the current query.
     */
    isDirectMatch(id: FileID, query: string): boolean;

    /** 
     * Sorts a list of sibling nodes.
     */
    sort(ids: FileID[]): FileID[];
}

export class StandardTreePipeline implements TreePipeline {
    private excludedExtensions: Set<string>;

    constructor(
        private app: App,
        private graph: IGraphEngine,
        private metricsManager: MetricsManager,
        public config: {
            sortConfig: SortConfig;
            filterQuery: string | null;
            groupRoots: Set<FileID>;
            excludeExtensions: string[];
            searchShowDescendants: boolean;
            searchShowAncestors: boolean;
        }
    ) {
        this.excludedExtensions = new Set(
            config.excludeExtensions
                .map(ext => ext.toLowerCase().trim().replace(/^\./, ""))
                .filter(ext => ext.length > 0)
        );
        this.matchCache = new Map();
        this.ancestorMatchCache = new Map();
    }

    private matchCache: Map<FileID, boolean>;
    private ancestorMatchCache: Map<FileID, boolean>;

    /**
     * Extracts and normalizes the extension from a file ID or metadata.
     */
    private getNormalizedExtension(id: FileID, meta: NodeMeta | undefined): string {
        let extension = "";
        
        if (meta?.extension) {
            extension = meta.extension;
        } else {
            const abstractFile = this.app.vault.getAbstractFileByPath(id);
            if (abstractFile instanceof TFile) {
                extension = abstractFile.extension;
            } else {
                // Fallback to path extension if it's a folder or ghost file
                // Only treat it as an extension if it's not a hidden file (starts with dot)
                // and has a dot later in the string.
                const fileName = id.split('/').pop() || "";
                if (fileName.includes('.') && !fileName.startsWith('.')) {
                    extension = fileName.split('.').pop() || "";
                }
            }
        }

        return extension.toLowerCase().replace(/^\./, "").trim();
    }

    isExcluded(id: FileID, meta: NodeMeta | undefined): boolean {
        const cleanExt = this.getNormalizedExtension(id, meta);

        if (cleanExt && this.excludedExtensions.has(cleanExt)) {
            return true;
        }
        
        return false;
    }

    matches(id: FileID, meta: NodeMeta | undefined, parentId?: FileID): boolean {
        // Search Filtering
        if (this.config.filterQuery && this.config.filterQuery.trim().length > 0) {
            const query = this.config.filterQuery.toLowerCase();
            const cacheKey = `${id}:${parentId || ""}`;
            
            if (this.matchCache.has(cacheKey)) {
                return this.matchCache.get(cacheKey)!;
            }

            // Hard exclusion check before matching
            if (this.isExcluded(id, meta)) {
                this.matchCache.set(cacheKey, false);
                return false;
            }

            let isMatch = false;

            // 1. Direct Match
            if (this.isDirectMatch(id, query)) {
                isMatch = true;
            }

            // 2. Ancestor Match (Show Descendants)
            if (!isMatch && this.config.searchShowDescendants && this.hasMatchingAncestor(id, query, new Set(), parentId)) {
                isMatch = true;
            }

            // 3. Descendant Match (Standard Search / Show Ancestors)
            if (!isMatch && this.config.searchShowAncestors && this.hasMatchingDescendant(id, query)) {
                isMatch = true;
            }

            this.matchCache.set(cacheKey, isMatch);
            return isMatch;
        }

        return true;
    }

    public isDirectMatch(id: FileID, query: string): boolean {
        const name = this.getNodeName(id).toLowerCase();
        return name.includes(query);
    }

    private hasMatchingAncestor(id: FileID, query: string, visited: Set<FileID> = new Set(), specificParentId?: FileID): boolean {
        if (visited.has(id)) return false;
        visited.add(id);

        const cacheKey = `${id}:${specificParentId || ""}`;
        if (this.ancestorMatchCache.has(cacheKey)) {
            return this.ancestorMatchCache.get(cacheKey)!;
        }

        // If a specificParentId is provided, we ONLY check that parent to enforce path-specificity
        const parents = specificParentId ? [specificParentId] : this.graph.getParents(id);

        let match = false;
        for (const parentId of parents) {
            // Important: We must check if the parent itself is excluded
            const parentMeta = this.graph.getNodeMeta(parentId);
            if (this.isExcluded(parentId, parentMeta)) continue;

            if (this.isDirectMatch(parentId, query) || this.hasMatchingAncestor(parentId, query, visited)) {
                match = true;
                break;
            }
        }

        this.ancestorMatchCache.set(cacheKey, match);
        return match;
    }

    private hasMatchingDirectChild(id: FileID, query: string): boolean {
        const children = this.graph.getChildren(id);
        for (const childId of children) {
            const childMeta = this.graph.getNodeMeta(childId);
            if (this.isExcluded(childId, childMeta)) continue;

            if (this.isDirectMatch(childId, query)) {
                return true;
            }
        }
        return false;
    }

    private hasMatchingDescendant(id: FileID, query: string, visited: Set<FileID> = new Set()): boolean {
        // Prevent infinite recursion in case of graph cycles
        if (visited.has(id)) return false;
        visited.add(id);

        const children = this.graph.getChildren(id);
        for (const childId of children) {
            // Check extension filters for children during search to prevent "ghost matches"
            const childMeta = this.graph.getNodeMeta(childId);
            
            if (this.isExcluded(childId, childMeta)) {
                continue;
            }

            // [FIX] Recursive context check
            // We only count a child as a matching descendant if it is actually reachable
            // and not hidden by other filters.
            if (this.isDirectMatch(childId, query)) {
                return true;
            }
            
            // Recurse
            if (this.hasMatchingDescendant(childId, query, visited)) {
                return true;
            }
        }

        return false;
    }

    isStructural(id: FileID): boolean {
        return this.config.groupRoots.has(id);
    }

    updateGroupRoots(roots: Set<FileID>): void {
        this.config.groupRoots = roots;
        this.matchCache.clear();
        this.ancestorMatchCache.clear();
    }

    sort(ids: FileID[]): FileID[] {
        const { sortBy, sortOrder } = this.config.sortConfig;
        
        const sortStartTime = performance.now();

        // 1. Pre-fetch all necessary metadata for $O(N \log N)$ stability without re-evaluating
        interface SortMeta {
            isFolder: boolean;
            name: string;
            mtime: number;
            ctime: number;
            thermal: number;
            rot: number;
            gravity: number;
        }

        const metaMap = new Map<string, SortMeta>();

        for (const id of ids) {
            const file = this.app.vault.getAbstractFileByPath(id);
            const isFolder = file instanceof TFolder;
            const name = this.getNodeName(id);
            const graphMeta = this.graph.getNodeMeta(id);

            let mtime = 0;
            let ctime = 0;

            if (file instanceof TFile) {
                mtime = file.stat.mtime;
                ctime = file.stat.ctime;
            } else if (graphMeta) {
                mtime = graphMeta.mtime || 0;
                ctime = graphMeta.mtime || 0; // fallback ctime to mtime for graph items
            }

            let thermal = 0;
            let rot = 0;
            let gravity = 0;

            if (sortBy === 'thermal' || sortBy === 'rot' || sortBy === 'gravity') {
                const metrics = this.metricsManager.getMetrics(id);
                thermal = metrics.thermal;
                rot = metrics.rot;
                gravity = metrics.gravity;
            }

            metaMap.set(id, {
                isFolder,
                name,
                mtime,
                ctime,
                thermal,
                rot,
                gravity
            });
        }

        const sorted = [...ids].sort((a, b) => {
            const metaA = metaMap.get(a)!;
            const metaB = metaMap.get(b)!;
            
            // Real Folders first (Traditional Obsidian Behavior)
            if (metaA.isFolder !== metaB.isFolder) return metaA.isFolder ? -1 : 1;

            let cmp = 0;

            if (sortBy === 'name') {
                cmp = metaA.name.localeCompare(metaB.name, undefined, { numeric: true, sensitivity: 'base' });
            } else if (sortBy === 'mtime') {
                cmp = metaA.mtime - metaB.mtime;
            } else if (sortBy === 'ctime') {
                cmp = metaA.ctime - metaB.ctime;
            } else if (sortBy === 'thermal') {
                cmp = metaA.thermal - metaB.thermal;
            } else if (sortBy === 'rot') {
                cmp = metaA.rot - metaB.rot;
            } else if (sortBy === 'gravity') {
                cmp = metaA.gravity - metaB.gravity;
            } else {
                cmp = metaA.name.localeCompare(metaB.name, undefined, { numeric: true, sensitivity: 'base' });
            }

            // Fallback to name if criteria is equal
            if (cmp === 0) {
                cmp = metaA.name.localeCompare(metaB.name, undefined, { numeric: true, sensitivity: 'base' });
            }

            const result = sortOrder === 'asc' ? cmp : -cmp;
            return result;
        });
        const sortEndTime = performance.now();
        Logger.debug(`[Abstract Folder] Sort: Sorting ${ids.length} items by ${sortBy} (${sortOrder}) took ${(sortEndTime - sortStartTime).toFixed(2)}ms`);
        return sorted;
    }

    private getNodeName(path: string): string {
        return path.split('/').pop() || path;
    }
}
