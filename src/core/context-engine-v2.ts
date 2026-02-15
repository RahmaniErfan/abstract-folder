import { EventEmitter } from 'events';
import { SortConfig } from '../types';
import { Logger } from 'src/utils/logger';
import { NodeLocationMap } from './tree-builder';

export interface ContextStateV2 {
    /** Currently selected Synthetic URIs */
    selectedURIs: Set<string>;
    /** Visually expanded folders (Synthetic URIs) */
    expandedURIs: Set<string>;
    /** The keyboard focus cursor */
    focusedURI: string | null;
    /** Current fuzzy search/filter query */
    activeFilter: string | null;
    /** Sorting preference */
    sortConfig: SortConfig;
}

/**
 * ContextEngineV2 is the Single Source of Truth for transient UI state.
 * It uses the Action-Reducer pattern to ensure atomic, reactive updates.
 */
export class ContextEngineV2 extends EventEmitter {
    private state: ContextStateV2;
    /** Stable reference to physical paths of selections for the Repair Cycle */
    private selectedPaths: Set<string> = new Set();
    /** Stable reference to physical paths of expansions for the Repair Cycle */
    private expandedPaths: Set<string> = new Set();

    constructor(initialState?: Partial<ContextStateV2>) {
        super();
        this.state = {
            selectedURIs: initialState?.selectedURIs || new Set(),
            expandedURIs: initialState?.expandedURIs || new Set(),
            focusedURI: initialState?.focusedURI || null,
            activeFilter: initialState?.activeFilter || null,
            sortConfig: initialState?.sortConfig || { sortBy: 'name', sortOrder: 'asc' }
        };
    }

    getState(): ContextStateV2 {
        return {
            ...this.state,
            selectedURIs: new Set(this.state.selectedURIs),
            expandedURIs: new Set(this.state.expandedURIs)
        };
    }

    // =========================================================================================
    // Actions (Writers)
    // =========================================================================================

    /**
     * Handles single and multi-selection
     */
    select(uri: string, options?: { multi?: boolean, range?: boolean, flatList?: string[] }): void {
        if (options?.range && options.flatList && this.state.focusedURI) {
            const start = options.flatList.indexOf(this.state.focusedURI);
            const end = options.flatList.indexOf(uri);
            
            if (start !== -1 && end !== -1) {
                const [low, high] = [Math.min(start, end), Math.max(start, end)];
                // Range select adds to existing selection if multi is also pressed,
                // but usually, it replaces the selection in standard file explorers.
                // We'll follow the "replace" pattern unless multi is also true.
                if (!options.multi) {
                    this.state.selectedURIs.clear();
                }
                for (let i = low; i <= high; i++) {
                    this.state.selectedURIs.add(options.flatList[i]);
                }
            }
        } else if (options?.multi) {
            if (this.state.selectedURIs.has(uri)) {
                this.state.selectedURIs.delete(uri);
            } else {
                this.state.selectedURIs.add(uri);
            }
        } else {
            this.state.selectedURIs.clear();
            this.state.selectedURIs.add(uri);
        }
        
        // Update focus cursor on every selection
        this.state.focusedURI = uri;
        
        this.emit('selection-changed', this.state.selectedURIs);
        this.emit('changed', this.getState());
    }

    /**
     * Toggles expansion state of a folder
     */
    toggleExpand(uri: string): void {
        Logger.debug(`[Abstract Folder] Context: Toggling expand for ${uri}`);
        if (this.state.expandedURIs.has(uri)) {
            this.state.expandedURIs.delete(uri);
        } else {
            this.state.expandedURIs.add(uri);
        }
        this.emit('changed', this.getState());
    }

    setFilter(query: string): void {
        this.state.activeFilter = query.trim() || null;
        this.emit('changed', this.getState());
    }

    setFocus(uri: string | null): void {
        this.state.focusedURI = uri;
        this.emit('changed', this.getState());
    }

    collapseAll(): void {
        this.state.expandedURIs.clear();
        this.emit('changed', this.getState());
    }

    setSortConfig(config: SortConfig): void {
        this.state.sortConfig = config;
        this.emit('changed', this.getState());
    }

    // =========================================================================================
    // Queries (Readers)
    // =========================================================================================

    isSelected(uri: string): boolean {
        return this.state.selectedURIs.has(uri);
    }

    isExpanded(uri: string): boolean {
        const expanded = this.state.expandedURIs.has(uri);
        if (expanded) {
            Logger.debug(`[Abstract Folder] Context: URI ${uri} is EXPANDED`);
        }
        return expanded;
    }

    isFocused(uri: string): boolean {
        return this.state.focusedURI === uri;
    }

    // =========================================================================================
    // State Repair Cycle
    // =========================================================================================

    /**
     * Snapshots the current synthetic URIs into physical file paths.
     * This must be called BEFORE a graph rebuild if we want to preserve state.
     * @param locationMap The map from the current (pre-rebuild) tree snapshot
     */
    snapshotPhysicalPaths(locationMap: NodeLocationMap): void {
        this.selectedPaths.clear();
        this.expandedPaths.clear();

        // Since one physical path can map to multiple URIs, we store the path
        // if ANY of its URIs are selected/expanded.
        for (const [path, uris] of locationMap.entries()) {
            for (const uri of uris) {
                if (this.state.selectedURIs.has(uri)) {
                    this.selectedPaths.add(path);
                }
                if (this.state.expandedURIs.has(uri)) {
                    this.expandedPaths.add(path);
                }
            }
        }
        
        Logger.debug(`[Abstract Folder] Context: Snapshot complete. Paths - Selected: ${this.selectedPaths.size}, Expanded: ${this.expandedPaths.size}`);
    }

    /**
     * Repairs the synthetic URIs based on a new location map.
     * This is called AFTER a graph rebuild.
     * @param locationMap The map from the new (post-rebuild) tree snapshot
     */
    repairState(locationMap: NodeLocationMap): void {
        const newSelectedURIs = new Set<string>();
        const newExpandedURIs = new Set<string>();

        for (const path of this.selectedPaths) {
            const uris = locationMap.get(path);
            if (uris) uris.forEach(uri => newSelectedURIs.add(uri));
        }

        for (const path of this.expandedPaths) {
            const uris = locationMap.get(path);
            if (uris) uris.forEach(uri => newExpandedURIs.add(uri));
        }

        this.state.selectedURIs = newSelectedURIs;
        this.state.expandedURIs = newExpandedURIs;

        Logger.debug(`[Abstract Folder] Context: State repaired. URIs - Selected: ${this.state.selectedURIs.size}, Expanded: ${this.state.expandedURIs.size}`);
        
        // Notify projector and viewport if selection changed
        this.emit('selection-changed', this.state.selectedURIs);
        this.emit('changed', this.getState());
    }
}
