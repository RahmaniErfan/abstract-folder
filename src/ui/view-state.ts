import { AbstractFolderPluginSettings } from '../settings';
import AbstractFolderPlugin from 'main'; // Import the plugin class

export class ViewState {
    private settings: AbstractFolderPluginSettings;
    private plugin: AbstractFolderPlugin;

    public sortOrder: 'asc' | 'desc';
    public sortBy: 'name' | 'mtime';
    public selectionPath: string[];
    public multiSelectedPaths: Set<string>;

    constructor(settings: AbstractFolderPluginSettings, plugin: AbstractFolderPlugin) {
        this.settings = settings;
        this.plugin = plugin;
        this.sortOrder = 'asc';
        this.sortBy = 'name';
        this.selectionPath = [];
        this.multiSelectedPaths = new Set();
    }

    setSort(sortBy: 'name' | 'mtime', sortOrder: 'asc' | 'desc') {
        this.sortBy = sortBy;
        this.sortOrder = sortOrder;
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