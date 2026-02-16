import { App, TFile } from "obsidian";
import { FileID, IGraphEngine, NodeMeta } from "./graph-engine";
import { SortConfig } from "../types";
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
    matches(id: FileID, meta: NodeMeta | undefined): boolean;

    /**
     * Determines if a node is structural (e.g., a group root or an expanded parent)
     * and should remain visible even if it doesn't match the search.
     */
    isStructural(id: FileID): boolean;

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
        private config: {
            sortConfig: SortConfig;
            filterQuery: string | null;
            groupRoots: Set<FileID>;
            excludeExtensions: string[];
        }
    ) {
        this.excludedExtensions = new Set(
            config.excludeExtensions
                .map(ext => ext.toLowerCase().trim().replace(/^\./, ""))
                .filter(ext => ext.length > 0)
        );

        Logger.debug(`[Abstract Folder] Pipeline: Processed excluded extensions:`, Array.from(this.excludedExtensions));

        Logger.debug(`[Abstract Folder] Pipeline: Initialized with config:`, {
            excludedExtensions: Array.from(this.excludedExtensions),
            filterQuery: config.filterQuery
        });
    }

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
            Logger.debug(`[Abstract Folder] Pipeline: MATCHED EXCLUSION for ${id} (ext: '${cleanExt}')`);
            return true;
        }
        
        return false;
    }

    matches(id: FileID, meta: NodeMeta | undefined): boolean {
        // Search Filtering (Recursive check: match if this node matches OR any descendant matches)
        if (this.config.filterQuery && this.config.filterQuery.trim().length > 0) {
            const query = this.config.filterQuery.toLowerCase();
            return this.recursiveSearchMatch(id, query);
        }

        return true;
    }

    private recursiveSearchMatch(id: FileID, query: string): boolean {
        const name = this.getNodeName(id).toLowerCase();
        if (name.includes(query)) {
            return true;
        }

        const children = this.graph.getChildren(id);
        for (const childId of children) {
            // Check extension filters for children during search to prevent "ghost matches"
            const childMeta = this.graph.getNodeMeta(childId);
            const cleanChildExt = this.getNormalizedExtension(childId, childMeta);
            
            if (cleanChildExt && this.excludedExtensions.has(cleanChildExt)) {
                continue;
            }

            if (this.recursiveSearchMatch(childId, query)) {
                return true;
            }
        }

        return false;
    }

    isStructural(id: FileID): boolean {
        return this.config.groupRoots.has(id);
    }

    sort(ids: FileID[]): FileID[] {
        const { sortOrder } = this.config.sortConfig;
        
        return [...ids].sort((a, b) => {
            const metaA = this.graph.getChildren(a).length > 0; // simplistic folder check
            const metaB = this.graph.getChildren(b).length > 0;
            
            // Folder first (optional, following V1 convention)
            if (metaA !== metaB) return metaA ? -1 : 1;

            const nameA = this.getNodeName(a);
            const nameB = this.getNodeName(b);
            
            const cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
            return sortOrder === 'asc' ? cmp : -cmp;
        });
    }

    private getNodeName(path: string): string {
        return path.split('/').pop() || path;
    }
}
