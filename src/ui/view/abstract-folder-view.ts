import { ItemView, WorkspaceLeaf } from "obsidian";
import AbstractFolderPlugin from '../../../main';
import { TreeFacet } from "../components/tree-facet";
import { Logger } from "../../utils/logger";

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

/**
 * AbstractFolderView is the primary view for the plugin.
 * Refactored to use the SOVM (Service-Oriented View Model) architecture.
 */
export class AbstractFolderView extends ItemView {
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

        // Initialize the TreeFacet (which manages the Viewport and Coordinator interaction)
        this.treeFacet = new TreeFacet(
            this.plugin.treeCoordinator,
            this.plugin.contextEngine,
            contentEl
        );

        // Mount the facet
        this.treeFacet.onMount();
        Logger.debug("AbstractFolderView: TreeFacet mounted.");
    }

    async onClose() {
        Logger.debug("AbstractFolderView: Closing...");
        if (this.treeFacet) {
            this.treeFacet.onDestroy();
            this.treeFacet = null;
        }
    }
}
