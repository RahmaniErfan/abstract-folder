import { EventEmitter } from 'events';
import { SortConfig } from '../types';

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
    select(uri: string, options?: { multi?: boolean }): void {
        if (options?.multi) {
            if (this.state.selectedURIs.has(uri)) {
                this.state.selectedURIs.delete(uri);
            } else {
                this.state.selectedURIs.add(uri);
            }
        } else {
            this.state.selectedURIs.clear();
            this.state.selectedURIs.add(uri);
        }
        
        this.emit('selection-changed', this.state.selectedURIs);
        this.emit('changed', this.getState());
    }

    /**
     * Toggles expansion state of a folder
     */
    toggleExpand(uri: string): void {
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
        return this.state.expandedURIs.has(uri);
    }

    isFocused(uri: string): boolean {
        return this.state.focusedURI === uri;
    }
}
