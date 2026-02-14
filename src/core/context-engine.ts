import { ResourceURI, URIUtils } from "./uri";

export interface ContextState {
    expandedURIs: Set<string>;
    selectedURIs: Set<string>;
    activeGroup: string | null;
    searchQuery: string;
}

export type StateListener = (state: ContextState) => void;

/**
 * ContextEngine manages the reactive state of a specific view instance.
 * It uses ResourceURIs to ensure state consistency across different view contexts.
 */
export class ContextEngine {
    private state: ContextState;
    private listeners: Set<StateListener> = new Set();

    constructor(initialState?: Partial<ContextState>) {
        this.state = {
            expandedURIs: initialState?.expandedURIs || new Set(),
            selectedURIs: initialState?.selectedURIs || new Set(),
            activeGroup: initialState?.activeGroup || null,
            searchQuery: initialState?.searchQuery || "",
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
        const stateCopy = this.getState();
        this.listeners.forEach(l => l(stateCopy));
    }

    /**
     * Toggles expansion state for a URI.
     */
    toggleExpansion(uri: ResourceURI) {
        const uriString = URIUtils.toString(uri);
        if (this.state.expandedURIs.has(uriString)) {
            this.state.expandedURIs.delete(uriString);
        } else {
            this.state.expandedURIs.add(uriString);
        }
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
}
