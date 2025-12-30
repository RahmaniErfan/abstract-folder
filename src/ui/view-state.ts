import { AbstractFolderPluginSettings } from '../settings';
import AbstractFolderPlugin from 'main'; // Import the plugin class

import { SortBy } from '../types';

export class ViewState {
    private settings: AbstractFolderPluginSettings;
    private plugin: AbstractFolderPlugin;

    public sortOrder: 'asc' | 'desc';
    public sortBy: SortBy;
    public excludeExtensions: string[];
    public selectionPath: string[];
    public multiSelectedPaths: Set<string>;

    constructor(settings: AbstractFolderPluginSettings, plugin: AbstractFolderPlugin) {
        this.settings = settings;
        this.plugin = plugin;
        this.sortOrder = 'asc';
        this.sortBy = 'name';
        this.excludeExtensions = [];
        this.selectionPath = [];
        this.multiSelectedPaths = new Set();
        
        // Initialize sort and filter from settings
        this.initializeSortAndFilter();
    }
    
    initializeSortAndFilter() {
        let sortConfig = this.settings.defaultSort;
        let filterConfig = this.settings.defaultFilter;
        if (this.settings.activeGroupId) {
             const activeGroup = this.settings.groups.find(g => g.id === this.settings.activeGroupId);
             if (activeGroup) {
                 if (activeGroup.sort) {
                     sortConfig = activeGroup.sort;
                 }
                 if (activeGroup.filter) {
                     filterConfig = activeGroup.filter;
                 }
             }
        }
        this.sortBy = sortConfig.sortBy;
        this.sortOrder = sortConfig.sortOrder;
        this.excludeExtensions = filterConfig.excludeExtensions;
    }

    setSort(sortBy: SortBy, sortOrder: 'asc' | 'desc') {
        this.sortBy = sortBy;
        this.sortOrder = sortOrder;
        this.plugin.app.workspace.trigger('abstract-folder:graph-updated'); // Trigger re-render
    }

    setFilter(excludeExtensions: string[]) {
        this.excludeExtensions = excludeExtensions;
        this.plugin.app.workspace.trigger('abstract-folder:graph-updated'); // Trigger re-render
    }

    toggleViewStyle() {
        this.settings.viewStyle = this.settings.viewStyle === 'tree' ? 'column' : 'tree';
        this.plugin.saveSettings().catch(console.error); // Save settings via the plugin instance
        this.plugin.app.workspace.trigger('abstract-folder:view-style-changed'); // Trigger re-render and button update
    }

    clearMultiSelection() {
        if (this.multiSelectedPaths.size > 0) {
            this.multiSelectedPaths.clear();
            this.plugin.app.workspace.trigger('abstract-folder:graph-updated'); // Re-render to clear selection
        }
    }

    toggleMultiSelect(path: string) {
        if (this.multiSelectedPaths.has(path)) {
            this.multiSelectedPaths.delete(path);
        } else {
            this.multiSelectedPaths.add(path);
        }
        this.plugin.app.workspace.trigger('abstract-folder:graph-updated'); // Re-render to show selection
    }


    resetSelectionPath() {
        this.selectionPath = [];
        this.plugin.app.workspace.trigger('abstract-folder:graph-updated'); // Re-render
    }
}