import { App, TFile } from "obsidian";
import { FileID, IGraphEngine, NodeMeta } from "./graph-engine";
import { SortConfig } from "../types";
import { Logger } from "../utils/logger";

export interface TreePipeline {
    /** 
     * Determines if a node matches the active filters (search, extensions, etc.) 
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
    constructor(
        private app: App,
        private graph: IGraphEngine,
        private config: {
            sortConfig: SortConfig;
            filterQuery: string | null;
            groupRoots: Set<FileID>;
            hideImages: boolean;
            hideCanvas: boolean;
        }
    ) {
        Logger.debug(`[Abstract Folder] Pipeline: Initialized with config:`, {
            hideImages: config.hideImages,
            hideCanvas: config.hideCanvas,
            filterQuery: config.filterQuery
        });
    }

    matches(id: FileID, meta: NodeMeta | undefined): boolean {
        // 1. Extension Filtering (Authoritative check via Obsidian API)
        const abstractFile = this.app.vault.getAbstractFileByPath(id);
        
        if (abstractFile instanceof TFile) {
            const ext = abstractFile.extension.toLowerCase();
            const isImage = ext === "png" || ext === "jpg" || ext === "jpeg";
            const isCanvas = ext === "canvas";

            if (isImage && this.config.hideImages) {
                return false;
            }
            if (isCanvas && this.config.hideCanvas) {
                return false;
            }
        } else {
            // If it's not a TFile (e.g. folder), but ends with an image extension (Obsidian ghost file?)
            const pathLower = id.toLowerCase();
            const isImage = pathLower.endsWith(".png") || pathLower.endsWith(".jpg") || pathLower.endsWith(".jpeg");
            if (isImage && this.config.hideImages) {
                return false;
            }
        }

        // 2. Search Filtering (Recursive check: match if this node matches OR any descendant matches)
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
            const childFile = this.app.vault.getAbstractFileByPath(childId);
            if (childFile instanceof TFile) {
                const ext = childFile.extension.toLowerCase();
                const isImage = ext === "png" || ext === "jpg" || ext === "jpeg";
                const isCanvas = ext === "canvas";
                
                if (isImage && this.config.hideImages) continue;
                if (isCanvas && this.config.hideCanvas) continue;
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
