import { ItemView, WorkspaceLeaf, setIcon, TFolder, TFile, Platform, Notice } from "obsidian";
import type AbstractFolderPlugin from "../../../main";
import { LibraryNode } from "../types";
import { Logger } from "../../utils/logger";
import { VirtualViewport, ViewportDelegate } from "../../ui/components/virtual-viewport";
import { ContextEngine } from "../../core/context-engine";
import { AbstractNode } from "../../core/tree-builder";

export const VIEW_TYPE_LIBRARY_EXPLORER = "abstract-library-explorer";

/**
 * LibraryExplorerView provides a dedicated interface for browsing installed libraries.
 * It features a "Shelf" view with pill-shaped selection and a scoped "Tree" view for the selected library.
 */
export class LibraryExplorerView extends ItemView implements ViewportDelegate {
    private viewport: VirtualViewport | null = null;
    private contextEngine: ContextEngine;
    private selectedLibrary: LibraryNode | null = null;
    private currentItems: AbstractNode[] = [];
    private searchQuery: string = "";
    private searchInput: HTMLInputElement;
    private clearSearchBtn: HTMLElement;
    private isRefreshing = false;
    private nextRefreshScheduled = false;
    private isOwner = false;

    // Search Options
    private showAncestors = true;
    private showDescendants = true;

    constructor(leaf: WorkspaceLeaf, private plugin: AbstractFolderPlugin) {
        super(leaf);
        this.contextEngine = new ContextEngine(plugin.settings);
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

    private renderSearch(container: HTMLElement, placeholder: string, onSearch: () => void, includeOptions = false): HTMLElement {
        const searchContainer = container.createDiv({ cls: "abstract-folder-search-container" });
        const wrapper = searchContainer.createDiv({ cls: "abstract-folder-search-input-wrapper" });
        
        this.searchInput = wrapper.createEl("input", {
            type: "text",
            placeholder: placeholder,
            cls: "abstract-folder-search-input",
            value: this.searchQuery
        });

        this.clearSearchBtn = wrapper.createDiv({
            cls: "abstract-folder-search-clear",
            attr: { "aria-label": "Clear search" }
        });
        setIcon(this.clearSearchBtn, "x");
        this.updateClearButtonState();

        this.searchInput.addEventListener("input", () => {
            this.searchQuery = this.searchInput.value;
            this.updateClearButtonState();
            onSearch();
        });

        this.clearSearchBtn.addEventListener("click", () => {
            this.searchQuery = "";
            this.searchInput.value = "";
            this.updateClearButtonState();
            this.searchInput.focus();
            onSearch();
        });

        if (includeOptions) {
            const optionsContainer = searchContainer.createDiv({ cls: "search-options-container" });

            const showAncestorsBtn = optionsContainer.createDiv({
                cls: "clickable-icon ancestry-search-toggle",
                attr: { "aria-label": "Show all ancestors in search" }
            });
            setIcon(showAncestorsBtn, "arrow-up-left");
            if (this.showAncestors) showAncestorsBtn.addClass("is-active");

            showAncestorsBtn.addEventListener("click", () => {
                this.showAncestors = !this.showAncestors;
                showAncestorsBtn.toggleClass("is-active", this.showAncestors);
                onSearch();
            });

            const showDescendantsBtn = optionsContainer.createDiv({
                cls: "clickable-icon ancestry-search-toggle",
                attr: { "aria-label": "Show all descendants in search" }
            });
            setIcon(showDescendantsBtn, "arrow-down-right");
            if (this.showDescendants) showDescendantsBtn.addClass("is-active");

            showDescendantsBtn.addEventListener("click", () => {
                this.showDescendants = !this.showDescendants;
                showDescendantsBtn.toggleClass("is-active", this.showDescendants);
                onSearch();
            });
        }

        return searchContainer;
    }

    private updateClearButtonState() {
        if (!this.clearSearchBtn) return;
        this.clearSearchBtn.toggleClass("is-active", this.searchQuery.length > 0);
    }

    private async renderShelf(container: HTMLElement) {
        container.createEl("h2", { text: "Libraries", cls: "shelf-title" });

        const searchRow = container.createDiv({ cls: "library-shelf-search-row" });
        this.renderSearch(searchRow, "Search libraries...", () => {
            void this.refreshShelf(shelfContainer);
        });

        const openCenterBtn = searchRow.createEl("button", {
            text: "Library center",
            cls: "library-open-center-btn"
        });
        openCenterBtn.addEventListener("click", () => {
            void this.plugin.activateLibraryCenter();
        });

        const shelfContainer = container.createDiv({ cls: "library-shelf" });
        await this.refreshShelf(shelfContainer);
    }

    private async refreshShelf(container: HTMLElement) {
        if (this.isRefreshing) {
            this.nextRefreshScheduled = true;
            return;
        }
        this.isRefreshing = true;
        this.nextRefreshScheduled = false;

        try {
            container.empty();
            const rawLibraries = await this.plugin.abstractBridge.discoverLibraries(this.plugin.settings.librarySettings.librariesPath);
        
        const libraries = rawLibraries.filter(lib => {
            if (!this.searchQuery) return true;
            const name = (lib.file instanceof TFolder) ? lib.file.name : "";
            return name.toLowerCase().includes(this.searchQuery.toLowerCase());
        });

        if (libraries.length === 0) {
            if (this.searchQuery) {
                container.createEl("p", { text: "No matching libraries found.", cls: "empty-state" });
            } else {
                container.createEl("p", {
                    text: "No libraries installed. Visit the library center to discover and install libraries.",
                    cls: "empty-state"
                });
                const openCenterBtn = container.createEl("button", { text: "Open library center" });
                openCenterBtn.addEventListener("click", () => {
                    void this.plugin.activateLibraryCenter();
                });
            }
            return;
        }

        const cardContainer = container.createDiv({ cls: "library-card-container" });

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
                this.searchQuery = ""; // Reset search when entering a library
                this.renderView();
            });
        });
        } catch (error) {
            Logger.error("LibraryExplorerView: Failed to refresh shelf", error);
        } finally {
            this.isRefreshing = false;
            if (this.nextRefreshScheduled) {
                this.nextRefreshScheduled = false;
                void this.refreshShelf(container);
            }
        }
    }

    private async renderLibraryTree(container: HTMLElement) {
        if (!this.selectedLibrary) return;

        const header = container.createDiv({ cls: "library-tree-header" });
        
        const titleRow = header.createDiv({ cls: "library-tree-title-row" });
        const backBtn = titleRow.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Back to shelf" } });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => {
            if (this.viewport) {
                this.viewport.destroy();
                this.viewport = null;
            }
            this.selectedLibrary = null;
            this.searchQuery = ""; // Reset search when going back to shelf
            this.renderView();
        });

        if (this.selectedLibrary.file instanceof TFolder) {
            titleRow.createEl("h3", { text: this.selectedLibrary.file.name });
        }

        header.createDiv({ cls: "library-header-divider" });

        this.renderTopToolbar(header);

        const searchRow = header.createDiv({ cls: "library-tree-search-row" });
        this.renderSearch(searchRow, "Search in library...", () => {
            void this.refreshLibraryTree();
        }, true); // Enable options for tree view

        const treeContainer = container.createDiv({ cls: "abstract-folder-tree-container" });
        const scrollContainer = treeContainer.createDiv({ cls: "abstract-folder-viewport-scroll-container nav-files-container" });
        const spacerEl = scrollContainer.createDiv({ cls: "abstract-folder-viewport-spacer" });
        const contentEl = scrollContainer.createDiv({ cls: "abstract-folder-viewport-rows" });

        await this.renderBottomToolbar(container);

        Logger.debug("LibraryExplorerView: Mounting Viewport for selected library.");

        this.viewport = new VirtualViewport(
            contentEl,
            scrollContainer,
            spacerEl,
            this.contextEngine,
            this.plugin.scopeProjector,
            this,
            { showGroupHeader: false }
        );
        await this.refreshLibraryTree();
    }

    private async refreshLibraryTree() {
        if (!this.viewport || !this.selectedLibrary) return;
        
        if (this.isRefreshing) {
            this.nextRefreshScheduled = true;
            return;
        }
        this.isRefreshing = true;
        this.nextRefreshScheduled = false;

        try {
            const libraryFile = this.selectedLibrary.file;
            const libraryPath = libraryFile ? libraryFile.path : null;
        
        // Strategic Cache Ingestion:
        // Before building the tree, we seed the GraphEngine with relationships
        // discovered by the Bridge's manual scan. This ensures the V2 Pipeline
        // sees the correct hierarchy even if Obsidian's cache is stale.
        if (libraryPath) {
            const relationships = this.plugin.abstractBridge.getLibraryRelationships(libraryPath);
            if (relationships) {
                this.plugin.graphEngine.seedRelationships(relationships);
            }
        }

        // Use the library's root folder as the active group to establish hierarchy
            const generator = this.plugin.treeBuilder.buildTree(
                this.contextEngine, 
                this.searchQuery, 
                !!this.searchQuery, 
                libraryPath,
                { showAncestors: this.showAncestors, showDescendants: this.showDescendants }
            );
        let result;
        while (true) {
            const next = await generator.next();
            if (next.done) {
                result = next.value;
                break;
            }
        }

            if (result) {
                this.currentItems = result.items;
                this.viewport.setItems(result.items);
                this.viewport.update();
            }
        } catch (error) {
            Logger.error("LibraryExplorerView: Failed to refresh library tree", error);
        } finally {
            this.isRefreshing = false;
            if (this.nextRefreshScheduled) {
                this.nextRefreshScheduled = false;
                void this.refreshLibraryTree();
            }
        }
    }

    private renderTopToolbar(container: HTMLElement) {
        const toolbar = container.createDiv({ cls: "library-tree-toolbar" });
        
        const forkBtn = toolbar.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Fork library (Coming soon)" } });
        setIcon(forkBtn, "git-fork");
        
        const prBtn = toolbar.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Create PR (Coming soon)" } });
        setIcon(prBtn, "git-pull-request");

        const issueBtn = toolbar.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Open Issue (Coming soon)" } });
        setIcon(issueBtn, "alert-circle");

        const starBtn = toolbar.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Star library (Coming soon)" } });
        setIcon(starBtn, "star");
    }

    private async renderBottomToolbar(container: HTMLElement) {
        const toolbar = container.createDiv({ cls: "library-tree-bottom-toolbar" });
        
        const infoArea = toolbar.createDiv({ cls: "library-bottom-info" });
        
        // Ownership check
        this.isOwner = false;
        let author = "Unknown";
        if (this.selectedLibrary?.file instanceof TFolder) {
            try {
                const config = await this.plugin.libraryManager.validateLibrary(this.selectedLibrary.file.path);
                author = config.author;
                this.isOwner = this.plugin.settings.librarySettings.githubUsername === author;
            } catch (e) {
                Logger.error("Failed to check ownership", e);
            }
        }

        const accessBadge = infoArea.createDiv({ 
            cls: `library-access-badge ${this.isOwner ? 'is-owner' : 'is-readonly'}`,
            text: this.isOwner ? "Owner" : "Read-only"
        });

        if (this.selectedLibrary?.file instanceof TFolder) {
            infoArea.createSpan({ cls: "library-name-info", text: this.selectedLibrary.file.name });
        }

        const actionsArea = toolbar.createDiv({ cls: "library-bottom-actions" });

        if (this.isOwner) {
            const pushBtn = actionsArea.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Push changes" } });
            setIcon(pushBtn, "arrow-up-circle");
            pushBtn.addEventListener("click", async () => {
                if (!this.selectedLibrary?.file) return;
                try {
                    new Notice("Pushing changes...");
                    await this.plugin.libraryManager.syncBackup(this.selectedLibrary.file.path, "Update library");
                    new Notice("Successfully pushed changes");
                } catch (e) {
                    new Notice(`Push failed: ${e.message}`);
                }
            });
        }

        const pullBtn = actionsArea.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Pull updates" } });
        setIcon(pullBtn, "refresh-cw");
        pullBtn.addEventListener("click", async () => {
            if (!this.selectedLibrary?.file) return;
            try {
                new Notice("Updating library...");
                await this.plugin.libraryManager.updateLibrary(this.selectedLibrary.file.path);
                new Notice("Library updated");
                void this.refreshLibraryTree();
            } catch (e) {
                new Notice(`Update failed: ${e.message}`);
            }
        });
    }

    // ViewportDelegateV2 implementation
    getItemHeight(): number {
        return 24;
    }

    isMobile(): boolean {
        return Platform.isMobile;
    }

    onItemClick(node: AbstractNode, event: MouseEvent): void {
        this.contextEngine.select(node.uri, { multi: event.ctrlKey || event.metaKey });
        const file = this.app.vault.getAbstractFileByPath(node.id);
        if (file instanceof TFile) {
            void this.app.workspace.getLeaf(false).openFile(file);
        }
    }

    onItemToggle(node: AbstractNode, event: MouseEvent): void {
        this.contextEngine.toggleExpand(node.uri);
        void this.refreshLibraryTree();
    }

    onItemContextMenu(node: AbstractNode, event: MouseEvent): void {
        const selection = this.contextEngine.getState().selectedURIs;

        this.plugin.contextMenuHandler.showV2ContextMenu(
            event,
            node,
            selection,
            this.currentItems,
            { isReadOnly: !this.isOwner }
        );
    }


    onItemDrop(draggedPath: string, targetNode: AbstractNode): void {
        // Library view might be read-only or have different D&D rules
    }

    async onClose() {
        if (this.viewport) {
            this.viewport.destroy();
            this.viewport = null;
        }
        this.currentItems = [];
    }
}
