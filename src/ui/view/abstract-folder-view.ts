import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import AbstractFolderPlugin from '../../../main';
import { TreeFacet } from "../components/tree-facet";
import { VirtualViewportV2, ViewportDelegateV2 } from "../components/virtual-viewport-v2";
import { DragManager } from "../dnd/drag-manager";
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

    // V2 stack
    private viewportV2: VirtualViewportV2 | null = null;

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
        
        // Reset selection silently
        this.plugin.contextEngine.silent(() => {
            this.plugin.contextEngine.clearSelection();
        });

        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("abstract-folder-view-container");

        // Ensure indexer starts building graph if it hasn't
        if (!this.plugin.indexer.hasBuiltFirstGraph()) {
            Logger.debug("AbstractFolderView: Indexer not ready, triggering initialization.");
            this.plugin.indexer.initializeIndexer();
        }

        if (this.plugin.settings.useV2Engine) {
            this.renderV2();
            return;
        }

        const toolbarContainer = contentEl.createDiv({ cls: "abstract-folder-toolbar-container" });
        const searchContainer = contentEl.createDiv({ cls: "abstract-folder-search-container" });
        const groupHeaderContainer = contentEl.createDiv({ cls: "abstract-folder-group-header-container" });
        const treeContainer = contentEl.createDiv({ cls: "abstract-folder-tree-container" });

        // Initialize Facets
        this.toolbarFacet = new ToolbarFacet(
            this.plugin.treeCoordinator,
            this.plugin.contextEngine,
            toolbarContainer,
            this.app,
            this.plugin.settings,
            () => this.plugin.saveSettings(),
            groupHeaderContainer,
            () => this.treeFacet?.treeContext || { providerIds: ['local'], libraryId: null }
        );

        // Initialize Search Facet
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
            this.plugin,
            { providerIds: ['local'] } // Explicitly isolate to local vault
        );

        // Initialize DragManager and connect to TreeFacet
        const dragManager = new DragManager(this.app, this.plugin.settings, this.plugin.indexer, this);
        this.treeFacet.setDragManager(dragManager);

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
        if (this.viewportV2) this.viewportV2.destroy();
        
        this.toolbarFacet = null;
        this.searchFacet = null;
        this.treeFacet = null;
        this.viewportV2 = null;
    }

    public focusSearch() {
        if (this.searchFacet) {
            this.searchFacet.focus();
        }
    }

    private renderV2() {
        const { contentEl } = this;
        contentEl.addClass("abstract-folder-v2-view");

        const toolbarContainer = contentEl.createDiv({ cls: "abstract-folder-toolbar-container" });
        toolbarContainer.createEl("h3", { text: "Abstract folder v2 (beta)" });

        const viewportWrapper = contentEl.createDiv({ cls: "abstract-folder-v2-wrapper" });
        const spacer = viewportWrapper.createDiv({ cls: "abstract-folder-v2-spacer" });
        const itemContainer = viewportWrapper.createDiv({ cls: "abstract-folder-v2-container" });

        const delegate: ViewportDelegateV2 = {
            getItemHeight: () => 24,
            onItemClick: (node) => {
                this.plugin.contextEngineV2.select(node.id);
                const abstractFile = this.app.vault.getAbstractFileByPath(node.path);
                if (abstractFile instanceof TFile) {
                    void this.app.workspace.getLeaf(false).openFile(abstractFile);
                }
            },
            onItemToggle: (node) => {
                this.plugin.contextEngineV2.toggleExpand(node.id);
                void this.refreshV2Tree();
            },
            onItemContextMenu: (node) => {
                // TODO: Context menu
            }
        };

        this.viewportV2 = new VirtualViewportV2(
            itemContainer,
            viewportWrapper,
            spacer,
            this.plugin.contextEngineV2,
            this.plugin.scopeProjector,
            delegate
        );

        // Listen for changes
        this.plugin.contextEngineV2.on('changed', () => {
            this.viewportV2?.update();
        });

        void this.refreshV2Tree();
    }

    private async refreshV2Tree() {
        if (!this.viewportV2) return;

        const generator = this.plugin.treeBuilder.buildTree();
        let result;
        while (true) {
            const next = await generator.next();
            if (next.done) {
                result = next.value;
                break;
            }
        }

        if (result) {
            this.viewportV2.setItems(result.flatList);
        }
    }
}
