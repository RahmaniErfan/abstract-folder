import { ItemView, WorkspaceLeaf, setIcon, TFolder } from "obsidian";
import type AbstractFolderPlugin from "../../../main";
import { TreeFacet } from "../../ui/components/tree-facet";
import { LibraryNode } from "../types";
import { Logger } from "../../utils/logger";

export const VIEW_TYPE_LIBRARY_EXPLORER = "abstract-library-explorer";

/**
 * LibraryExplorerView provides a dedicated interface for browsing installed libraries.
 * It features a "Shelf" view with pill-shaped selection and a scoped "Tree" view for the selected library.
 */
export class LibraryExplorerView extends ItemView {
    private treeFacet: TreeFacet | null = null;
    private selectedLibrary: LibraryNode | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: AbstractFolderPlugin) {
        super(leaf);
    }

    getViewType(): string {
        return VIEW_TYPE_LIBRARY_EXPLORER;
    }

    getDisplayText(): string {
        return "Library explorer";
    }

    getIcon(): string {
        return "library";
    }

    async onOpen() {
        // @ts-ignore - Internal workspace event
        this.registerEvent(this.app.workspace.on("abstract-folder:library-changed", () => {
            this.renderView();
        }));
        this.renderView();
    }

    private renderView() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("abstract-library-explorer");

        if (this.selectedLibrary) {
            void this.renderLibraryTree(container);
        } else {
            void this.renderShelf(container);
        }
    }

    private async renderShelf(container: HTMLElement) {
        container.createEl("h2", { text: "Libraries" });

        const shelfContainer = container.createDiv({ cls: "library-shelf" });
        const libraries = await this.plugin.abstractBridge.discoverLibraries(this.plugin.settings.librarySettings.librariesPath);

        if (libraries.length === 0) {
            shelfContainer.createEl("p", {
                text: "No libraries installed. Visit the library center to discover and install libraries.",
                cls: "empty-state"
            });
            const openCenterBtn = shelfContainer.createEl("button", { text: "Open library center" });
            openCenterBtn.addEventListener("click", () => {
                void this.plugin.activateLibraryCenter();
            });
            return;
        }

        const cardContainer = shelfContainer.createDiv({ cls: "library-card-container" });

        libraries.forEach(lib => {
            const card = cardContainer.createDiv({ cls: "library-explorer-card" });
            const iconContainer = card.createDiv({ cls: "library-card-icon" });
            setIcon(iconContainer, "folder-closed");
            
            const info = card.createDiv({ cls: "library-card-info" });
            if (lib.file instanceof TFolder) {
                info.createDiv({ cls: "library-card-name", text: lib.file.name });
            }
            
            card.addEventListener("click", () => {
                this.selectedLibrary = lib;
                // Invalidate cache when choosing a library to ensure fresh view
                this.plugin.libraryTreeProvider.invalidateCache();
                this.renderView();
            });
        });
    }

    private async renderLibraryTree(container: HTMLElement) {
        if (!this.selectedLibrary) return;

        const header = container.createDiv({ cls: "library-tree-header" });
        
        const backBtn = header.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Back to shelf" } });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => {
            if (this.treeFacet) {
                this.treeFacet.onDestroy();
                this.treeFacet = null;
            }
            this.selectedLibrary = null;
            this.renderView();
        });

        if (this.selectedLibrary.file instanceof TFolder) {
            header.createEl("h3", { text: this.selectedLibrary.file.name });
        }

        const treeContainer = container.createDiv({ cls: "abstract-folder-tree-container" });

        Logger.debug("LibraryExplorerView: Mounting TreeFacet for selected library.");

        this.treeFacet = new TreeFacet(
            this.plugin.treeCoordinator,
            this.plugin.contextEngine,
            treeContainer,
            this.app,
            this.plugin,
            {
                providerIds: ["library"],
                libraryId: this.selectedLibrary.libraryId
            }
        );

        this.treeFacet.onMount();
    }

    async onClose() {
        if (this.treeFacet) {
            this.treeFacet.onDestroy();
            this.treeFacet = null;
        }
    }
}
