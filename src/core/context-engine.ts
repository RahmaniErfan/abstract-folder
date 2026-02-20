import { EventEmitter } from 'events';
import { SortConfig, ScopeConfig } from '../types';
import { AbstractFolderPluginSettings } from '../settings';
import { Logger } from 'src/utils/logger';
import { FileID } from './graph-engine';
import type AbstractFolderPlugin from 'main';

export interface ContextState {
    /** Currently selected Synthetic URIs */
    selectedURIs: Set<string>;
    /** Visually expanded folders (Synthetic URIs) */
    expandedURIs: Set<string>;
    /** The keyboard focus cursor */
    focusedURI: string | null;
    /** Current fuzzy search/filter query */
    activeFilter: string | null;
    /** Currently active group ID */
    activeGroupId: string | null;
    /** Sorting preference */
    sortConfig: SortConfig;
}

/**
 * ContextEngineV2 is the Single Source of Truth for transient UI state.
 * It uses the Action-Reducer pattern to ensure atomic, reactive updates.
 */
export class ContextEngine extends EventEmitter {
    public settings: AbstractFolderPluginSettings;
    private plugin: AbstractFolderPlugin;
    private scope: string;
    private state: ContextState;
    /** Stable reference to physical paths of selections for the Repair Cycle */
    private selectedPaths: Set<string> = new Set();
    /** Stable reference to physical paths of expansions for the Repair Cycle */
    private expandedPaths: Set<string> = new Set();

    constructor(plugin: AbstractFolderPlugin, scope: string = 'global', initialState?: Partial<ContextState>) {
        super();
        this.plugin = plugin;
        this.settings = plugin.settings;
        this.scope = scope;
        
        // Ensure scope exists or initialize it
        this.ensureScopeInitialized(scope);
        const scopeConfig = this.settings.scopes[scope];

        this.state = {
            selectedURIs: initialState?.selectedURIs || new Set(),
            expandedURIs: initialState?.expandedURIs || new Set(),
            focusedURI: initialState?.focusedURI || null,
            activeFilter: initialState?.activeFilter || null,
            activeGroupId: initialState?.activeGroupId || scopeConfig?.activeGroupId || null,
            sortConfig: initialState?.sortConfig || scopeConfig?.sort || { sortBy: 'name', sortOrder: 'asc' }
        };
    }

    private ensureScopeInitialized(scope: string) {
        if (!this.settings.scopes) this.settings.scopes = {};
        if (!this.settings.scopes[scope]) {
            // If global, try usage of deprecated global settings for migration if we want?
            // For now, simple defaults.
            // If it's 'global' and we have deprecated values and NO scope entry, we could migrate here.
            if (scope === 'global' && !this.settings.scopes['global'] && this.settings.activeGroupId !== undefined) {
                 this.settings.scopes['global'] = {
                    activeGroupId: this.settings.activeGroupId,
                    sort: this.settings.defaultSort,
                    filter: this.settings.defaultFilter
                 };
            } else {
                this.settings.scopes[scope] = {
                    activeGroupId: null,
                    sort: { sortBy: 'name', sortOrder: 'asc' },
                    filter: { excludeExtensions: [] }
                };
            }
        }
    }
    
    public getScope(): string {
        return this.scope;
    }

    getState(): ContextState {
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

    /**
     * Sets explicit expansion state
     */
    setExpanded(uri: string, expanded: boolean): void {
        const currentlyExpanded = this.state.expandedURIs.has(uri);
        if (expanded === currentlyExpanded) return;

        if (expanded) {
            this.state.expandedURIs.add(uri);
        } else {
            this.state.expandedURIs.delete(uri);
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

    expandAll(): void {
        // We can't easily validly expand "ALL" because we don't know all IDs without traversing the graph.
        // However, usually "Expand All" in these views might mean "Expand everything currently loaded" or "Set a flag".
        // If we want to truly expand all, we might need a flag `expandAll: true` in state or let the TreeBuilder handle it.
        // TreeBuilder has `forceExpandAll` argument.
        // Let's add a transient flag or just emit an event that View listens to?
        // OR we can change `expandedURIs` to a special set or handle it in TreeBuilder.
        // For now, let's trigger a special state change or use the `forceExpandAll` mechanism via buildTree.
        // But context state should reflect it.
        // Let's defer to the view to handle "Expand All" logic via TreeBuilder, OR update all known URIs.
        // Since we don't track all URIs here, we can't populate `expandedURIs` exhaustively without GraphEngine.
        //
        // However, `AbstractFolderView` calls `treeBuilder.buildTree` with `forceExpandAll`.
        // Maybe we expose a way to set `forceExpandAll` in context?
        // But `ContextState` doesn't have it.
        // Let's emit a special event 'expand-all' that the View listens to.
        this.emit('expand-all');
    }

    setSortConfig(config: SortConfig): void {
        Logger.debug(`[Abstract Folder] Context: Setting sort config for scope ${this.scope}`, config);
        this.state.sortConfig = config;
        
        // Persist to scope
        this.ensureScopeInitialized(this.scope);
        this.settings.scopes[this.scope].sort = config;
        this.plugin.saveSettings().catch(Logger.error);
        
        this.emit('changed', this.getState());
    }

    setActiveGroup(groupId: string | null): void {
        Logger.debug(`[Abstract Folder] Context: Setting active group to ${groupId} for scope ${this.scope}`);
        this.state.activeGroupId = groupId;
        
        // Persist to scope
        this.ensureScopeInitialized(this.scope);
        this.settings.scopes[this.scope].activeGroupId = groupId;
        this.plugin.saveSettings().catch(Logger.error);
        
        this.emit('changed', this.getState());
    }

    // =========================================================================================
    // Group Management (Scoped)
    // =========================================================================================

    public getGroups(): import('../types').Group[] {
        if (!this.settings.groups) return [];
        // Return groups that match the current scope OR (migration strategy: legacy global groups if scope is global?)
        // The prompt said: "A group created in 'Personal' will strictly belong to 'Personal'."
        // So strict filtering is best.
        return this.settings.groups.filter(g => g.scope === this.scope);
    }

    public async createGroup(name: string, parentFolders: string[], sort?: SortConfig, filter?: import('../types').FilterConfig): Promise<string> {
        const newGroup: import('../types').Group = {
            id: crypto.randomUUID(),
            name,
            scope: this.scope,
            parentFolders,
            sort,
            filter
        };
        this.settings.groups.push(newGroup);
        await this.plugin.saveSettings();
        
        // Auto-select the new group?
        this.setActiveGroup(newGroup.id);
        
        return newGroup.id;
    }

    public async updateGroup(groupId: string, updates: Partial<Omit<import('../types').Group, 'id' | 'scope'>>): Promise<void> {
        const groupIndex = this.settings.groups.findIndex(g => g.id === groupId);
        if (groupIndex === -1) return;
        
        // Ensure we only update groups in current scope to be safe, though ID is unique.
        if (this.settings.groups[groupIndex].scope !== this.scope) {
             Logger.warn(`[Abstract Folder] Context: Attempted to update group ${groupId} from wrong scope ${this.scope}`);
             return;
        }

        this.settings.groups[groupIndex] = { ...this.settings.groups[groupIndex], ...updates };
        await this.plugin.saveSettings();
        
        // If this is the active group, trigger update
        if (this.state.activeGroupId === groupId) {
             // Re-set to trigger listeners if needed, or just emit changed
             if (updates.sort) {
                 this.setSortConfig(updates.sort);
             }
             this.emit('changed', this.getState());
        } else {
             this.emit('changed', this.getState()); 
        }
    }

    public async deleteGroup(groupId: string): Promise<void> {
        const initialLength = this.settings.groups.length;
        this.settings.groups = this.settings.groups.filter(g => g.id !== groupId);
        
        if (this.settings.groups.length !== initialLength) {
            if (this.state.activeGroupId === groupId) {
                this.setActiveGroup(null);
            }
            await this.plugin.saveSettings();
            this.emit('changed', this.getState());
        }
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

    // =========================================================================================
    // State Repair Cycle
    // =========================================================================================

    /**
     * Snapshots the current synthetic URIs into physical file paths.
     * This must be called BEFORE a graph rebuild if we want to preserve state.
     * @param locationMap The map from the current (pre-rebuild) tree snapshot
     */
    snapshotPhysicalPaths(locationMap: Map<FileID, string[]>): void {
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
    repairState(locationMap: Map<FileID, string[]>, options: { silent?: boolean } = {}): void {
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
        
        if (!options.silent) {
            this.emit('selection-changed', this.state.selectedURIs);
            this.emit('changed', this.getState());
        }
    }
}
