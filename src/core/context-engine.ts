import { TreeCoordinator } from "./tree-coordinator";
import { TreeContext } from "./tree-provider";
import { ResourceURI, URIUtils } from "./uri";

import { SortConfig } from "../types";

export interface ContextState {
    expandedURIs: Set<string>;
    selectedURIs: Set<string>;
    activeGroup: string | null;
    searchQuery: string;
    sortConfig: SortConfig;
}

export type StateListener = (state: ContextState) => void;

/**
 * ContextEngine manages the reactive state of a specific view instance.
 * It uses ResourceURIs to ensure state consistency across different view contexts.
 */
export class ContextEngine {
    private state: ContextState;
    private listeners: Set<StateListener> = new Set();
    private isSilent = false;

    constructor(initialState?: Partial<ContextState>, defaultSort?: SortConfig) {
        this.state = {
            expandedURIs: initialState?.expandedURIs || new Set(),
            selectedURIs: initialState?.selectedURIs || new Set(),
            activeGroup: initialState?.activeGroup || null,
            searchQuery: initialState?.searchQuery || "",
            sortConfig: initialState?.sortConfig || defaultSort || { sortBy: "name", sortOrder: "asc" },
        };
    }

    /**
     * Returns the current state.
     */
    getState(): ContextState {
        return { ...this.state };
    }

    /**
     * Subscribes to state changes.
     */
    subscribe(listener: StateListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify() {
        if (this.isSilent) return;
        const stateCopy = this.getState();
        this.listeners.forEach(l => l(stateCopy));
    }

    /**
     * Executes a callback without triggering notifications.
     */
    silent(callback: () => void) {
        const wasSilent = this.isSilent;
        this.isSilent = true;
        try {
            callback();
        } finally {
            this.isSilent = wasSilent;
        }
    }

    /**
     * Toggles expansion state for a URI.
     */
    toggleExpansion(uri: ResourceURI) {
        const uriString = URIUtils.toString(uri);
        // Create a new set to ensure reactivity and prevent reference-sharing issues
        const newExpanded = new Set(this.state.expandedURIs);
        if (newExpanded.has(uriString)) {
            newExpanded.delete(uriString);
        } else {
            newExpanded.add(uriString);
        }
        this.state.expandedURIs = newExpanded;
        this.notify();
    }

    /**
     * Sets expansion state for a set of URIs.
     */
    setExpanded(uris: string[]) {
        this.state.expandedURIs = new Set(uris);
        this.notify();
    }

    /**
     * Sets the current search query.
     */
    setSearchQuery(query: string) {
        if (this.state.searchQuery === query) return;
        this.state.searchQuery = query;
        this.notify();
    }

    /**
     * Collapses all nodes.
     */
    collapseAll() {
        this.state.expandedURIs.clear();
        this.notify();
    }

    /**
     * Sets the active group.
     */
    setActiveGroup(groupId: string | null) {
        if (this.state.activeGroup === groupId) return;
        this.state.activeGroup = groupId;
        this.notify();
    }

    /**
     * Sets the sort configuration.
     */
    setSortConfig(config: SortConfig) {
        this.state.sortConfig = config;
        this.notify();
    }

    /**
     * Selects a single URI.
     */
    select(uri: ResourceURI) {
        this.state.selectedURIs = new Set([URIUtils.toString(uri)]);
        this.notify();
    }

    /**
     * Clears all selections.
     */
    clearSelection() {
        if (this.state.selectedURIs.size === 0) return;
        this.state.selectedURIs.clear();
        this.notify();
    }
    /**
     * Expands all nodes in the tree.
     * Note: This only marks URIs as expanded; the TreeCoordinator determines if they have children.
     */
    async expandAll(coordinator: TreeCoordinator, context: TreeContext) {
        const items = await coordinator.getFlatVisibleItems(context);
        const folderUris = items
            .filter(node => node.isFolder)
            .map(node => URIUtils.toString(node.uri));
        
        folderUris.forEach((uri: string) => this.state.expandedURIs.add(uri));
        this.notify();
    }
}
