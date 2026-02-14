import { ItemView, WorkspaceLeaf } from "obsidian";
import AbstractFolderPlugin from '../../../main';
import { TreeFacet } from "../components/tree-facet";
import { ToolbarFacet } from "../components/toolbar-facet";
import { SearchFacet } from "../components/search-facet";
import { Logger } from "../../utils/logger";

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

/**
 * AbstractFolderView is the primary view for the plugin.
 * Refactored to use the SOVM (Service-Oriented View Model) architecture.
 */
export class AbstractFolderView extends ItemView {
    private toolbarFacet: ToolbarFacet | null = null;
    private searchFacet: SearchFacet | null = null;
    private treeFacet: TreeFacet | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        private plugin: AbstractFolderPlugin
    ) {
        super(leaf);
        this.icon = "folder-tree";
        this.navigation = false;
    }

    getViewType(): string {
        return VIEW_TYPE_ABSTRACT_FOLDER;
    }

    getDisplayText(): string {
        return "Abstract folder";
    }

    async onOpen() {
        Logger.debug("AbstractFolderView: Opening...");
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("abstract-folder-view-container");

        // Set coordinator to use all providers (local + library) for the main view
        this.plugin.treeCoordinator.setActiveProviders(null);
        
        // Ensure indexer starts building graph if it hasn't
        if (!this.plugin.indexer.hasBuiltFirstGraph()) {
            Logger.debug("AbstractFolderView: Indexer not ready, triggering initialization.");
            this.plugin.indexer.initializeIndexer();
        }

        const toolbarContainer = contentEl.createDiv({ cls: "abstract-folder-toolbar-container" });
        const searchContainer = contentEl.createDiv({ cls: "abstract-folder-search-container" });
        const treeContainer = contentEl.createDiv({ cls: "abstract-folder-tree-container" });

        // Initialize Facets
        this.toolbarFacet = new ToolbarFacet(
            this.plugin.treeCoordinator,
            this.plugin.contextEngine,
            toolbarContainer,
            this.app
        );

        this.searchFacet = new SearchFacet(
            this.plugin.treeCoordinator,
            this.plugin.contextEngine,
            searchContainer,
            this.app
        );

        this.treeFacet = new TreeFacet(
            this.plugin.treeCoordinator,
            this.plugin.contextEngine,
            treeContainer,
            this.app,
            this.plugin
        );

        // Mount Facets
        this.toolbarFacet.onMount();
        this.searchFacet.onMount();
        this.treeFacet.onMount();

        Logger.debug("AbstractFolderView: Facets mounted.");
    }

    async onClose() {
        Logger.debug("AbstractFolderView: Closing...");
        if (this.toolbarFacet) this.toolbarFacet.onDestroy();
        if (this.searchFacet) this.searchFacet.onDestroy();
        if (this.treeFacet) this.treeFacet.onDestroy();
        
        this.toolbarFacet = null;
        this.searchFacet = null;
        this.treeFacet = null;
    }

    public focusSearch() {
        if (this.searchFacet) {
            this.searchFacet.focus();
        }
    }
}
