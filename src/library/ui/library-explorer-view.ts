import { ItemView, WorkspaceLeaf, setIcon, TFolder, TFile, Platform, Notice, debounce } from "obsidian";
import type AbstractFolderPlugin from "../../../main";
import { LibraryNode } from "../types";
import { Logger } from "../../utils/logger";
import { VirtualViewport, ViewportDelegate } from "../../ui/components/virtual-viewport";
import { ContextEngine } from "../../core/context-engine";
import { AbstractNode } from "../../core/tree-builder";
import { ScopedContentProvider } from "../../core/content-provider";
import { AbstractFolderToolbar } from "../../ui/toolbar/abstract-folder-toolbar";
import { AbstractDashboardModal } from "../../ui/modals/abstract-dashboard-modal";

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
    private repositoryUrl: string | null = null;
    private authorName = "Unknown";
    private scopeUnsubscribe: (() => void) | null = null;
    private debouncedRefreshLibraryTree: (options?: { forceExpand?: boolean }) => void;


    // Search Options
    private showAncestors = true;
    private showDescendants = true;

    constructor(leaf: WorkspaceLeaf, private plugin: AbstractFolderPlugin) {
        super(leaf);
        this.contextEngine = new ContextEngine(plugin, 'library');
        this.debouncedRefreshLibraryTree = debounce(this.refreshLibraryTree.bind(this), 20);
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
        // @ts-ignore - Internal workspace event
        this.registerEvent(this.app.workspace.on("abstract-folder:git-refreshed", async (vaultPath?: string) => {
            // Surgical DOM Repainting
            // We only need to repaint if we are actually looking at the repo that changed
            if (this.selectedLibrary && this.selectedLibrary.file && this.viewport && vaultPath) {
                const repoPath = this.selectedLibrary.file.path;
                if (vaultPath.startsWith(repoPath) || repoPath.startsWith(vaultPath)) {
                    // 1. Fetch the fresh matrix to update the underlying AbstractNode data model
                    const matrix = await this.plugin.libraryManager.getFileStatuses(repoPath);
                    
                    // 2. Update the syncStatus on our current flat list of nodes
                    for (const node of this.currentItems) {
                        const relativePath = (repoPath !== "" && node.id.startsWith(repoPath)) ? 
                            (node.id === repoPath ? "" : node.id.substring(repoPath.length + 1)) : node.id;
                        const status = matrix.get(relativePath);
                        node.syncStatus = status || undefined;
                    }
                    
                    // 3. Command the VirtualViewport to surgically repaint only what's on screen
                    this.viewport.forceUpdateVisibleRows();
                }
            }
        }));
        
        // Listen for graph updates (e.g. new files) to refresh the tree
        // @ts-ignore
        this.registerEvent(this.app.workspace.on("abstract-folder:graph-updated", () => {
            if (this.selectedLibrary) {
                const header = this.containerEl.querySelector(".abstract-folder-header") as HTMLElement;
                if (header) this.renderHeader(header);
                this.debouncedRefreshLibraryTree();
            } else {
                this.renderView();
            }
        }));

        // Subscribe to context changes
        this.contextEngine.on('changed', () => {
            if (this.selectedLibrary) {
                this.debouncedRefreshLibraryTree();
            }
        });

        this.contextEngine.on('expand-all', () => {
            if (this.selectedLibrary) {
                this.debouncedRefreshLibraryTree({ forceExpand: true });
            }
        });

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
            const showAncestorsBtn = searchContainer.createDiv({
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

            const showDescendantsBtn = searchContainer.createDiv({
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

        container.createDiv({ cls: "library-header-divider" });

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

        const header = container.createDiv({ cls: "abstract-folder-header" });
        await this.renderHeader(header);

        header.createDiv({ cls: "library-header-divider" });

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
            { showGroupHeader: true }
        );
        await this.refreshLibraryTree();
    }

    private async renderHeader(header: HTMLElement) {
        header.empty();

        const titleRow = header.createDiv({ cls: "abstract-folder-header-title-container" });
        const backBtn = titleRow.createDiv({ cls: "af-header-back-button abstract-folder-toolbar-action clickable-icon", attr: { "aria-label": "Back to shelf" } });
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

        if (this.selectedLibrary!.file instanceof TFolder) {
            const meta = this.plugin.graphEngine?.getNodeMeta?.(this.selectedLibrary!.file.path);
            const iconToUse = meta?.icon || "library";
            
            const titleEl = titleRow.createEl("h3", { cls: "abstract-folder-header-title" });
            const iconEl = titleEl.createDiv({ cls: "af-header-icon" });
            setIcon(iconEl, iconToUse);
            titleEl.createSpan({ text: this.selectedLibrary!.file.name });
            
            // Pre-fetch ownership and repo info for toolbars
            const status = await this.plugin.libraryManager.isLibraryOwner(this.selectedLibrary!.file.path);
            this.isOwner = status.isOwner;
            this.authorName = status.author;
            this.repositoryUrl = status.repositoryUrl;
        }

        const visibility = this.plugin.settings.visibility.libraries;

        this.renderTopToolbar(header);

        if (visibility.showSearchHeader) {
            this.renderSearch(header, "Search in library...", () => {
                void this.refreshLibraryTree();
            }, true); // Enable options for tree view
        }
    }

    private async refreshLibraryTree(options: { forceExpand?: boolean } = {}) {
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
        
            // Strategic Cache Ingestion
            if (libraryPath) {
                const relationships = this.plugin.abstractBridge.getLibraryRelationships(libraryPath);
                if (relationships) {
                    this.plugin.graphEngine.seedRelationships(relationships);
                }
            }

            // Create Scoped Provider for Library
            // Use 'library' scope ID to match ContextEngine
            const provider = new ScopedContentProvider(
                this.plugin.app,
                this.plugin.settings,
                libraryPath || "",
                "library",
                true, // Enable groupings
                this.contextEngine.getState().activeGroupId
            );

            const generator = this.plugin.treeBuilder.buildTree(
                this.contextEngine, 
                provider,
                { 
                    filterQuery: this.searchQuery,
                    forceExpandAll: !!this.searchQuery || !!options.forceExpand,
                    showAncestors: this.showAncestors, 
                    showDescendants: this.showDescendants 
                }
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
                void this.refreshLibraryTree(options);
            }
        }
    }

    private renderTopToolbar(container: HTMLElement) {
        const toolbarContainer = container.createDiv({ cls: "abstract-folder-toolbar" });
        
        const libraryPath = this.selectedLibrary?.file?.path || "";
        const provider = new ScopedContentProvider(
            this.plugin.app, 
            this.plugin.settings, 
            libraryPath, 
            "library",
            true, 
            this.contextEngine.getState().activeGroupId
        );

        const visibility = this.plugin.settings.visibility.libraries;

        new AbstractFolderToolbar(
            this.app,
            this.plugin.settings,
            this.plugin,
            this.contextEngine,
            {
                containerEl: toolbarContainer,
                provider: provider,
                showFocusButton: visibility.showFocusActiveFileButton,
                showConversionButton: visibility.showConversionButton,
                showCollapseButton: visibility.showCollapseAllButton,
                showExpandButton: visibility.showExpandAllButton,
                showSortButton: visibility.showSortButton,
                showFilterButton: visibility.showFilterButton,
                showGroupButton: visibility.showGroupButton,
                showCreateNoteButton: visibility.showCreateNoteButton && this.isOwner,
                extraActions: (toolbarEl: HTMLElement) => {
                    // GitHub actions moved to UnifiedDashboardView
                }
            }
        ).render();
    }



    private async renderBottomToolbar(container: HTMLElement) {
        const toolbar = container.createDiv({ cls: "af-status-bar" });
        
        const identityArea = toolbar.createDiv({ cls: "af-status-identity" });
        
        // Ownership check
        // Handled by renderLibraryTree pre-fetch
        const author = this.authorName;

        const libraryIcon = identityArea.createDiv({ cls: "af-status-library-icon" });
        setIcon(libraryIcon, "library");

        const infoArea = identityArea.createDiv({ cls: "library-bottom-info-row" });
        if (this.selectedLibrary?.file instanceof TFolder) {
            infoArea.createSpan({ cls: "af-status-username", text: this.selectedLibrary.file.name });
        }

        infoArea.createDiv({ 
            cls: `library-access-badge-pill ${this.isOwner ? 'is-owner' : 'is-readonly'}`,
            text: this.isOwner ? "Owner" : "Read-only"
        });

        const controlsArea = toolbar.createDiv({ cls: "af-status-controls" });

        if (this.isOwner) {
            // Share Button
            const shareBtn = controlsArea.createDiv({ 
                cls: "af-status-control clickable-icon", 
                attr: { "aria-label": "Library Info & Settings" } 
            });
            setIcon(shareBtn, "cloud");
            shareBtn.addEventListener("click", () => {
                if (!this.selectedLibrary?.file) return;
                new AbstractDashboardModal(
                    this.app,
                    this.plugin,
                    this.selectedLibrary.file.path,
                    this.selectedLibrary.file.name,
                    true
                ).open();
            });

            const pushBtn = controlsArea.createDiv({ 
                cls: "af-status-control af-status-sync-btn clickable-icon", 
                attr: { "aria-label": "Push changes to remote" } 
            });
            const pushIconContainer = pushBtn.createDiv({ cls: "af-status-sync-icon" });
            setIcon(pushIconContainer, "upload-cloud");
            const pushBadge = pushIconContainer.createDiv({ cls: "af-status-sync-badge push-badge is-hidden" });
            pushBadge.style.backgroundColor = "var(--color-blue)";
            
            pushBtn.addEventListener("click", async () => {
                if (!this.selectedLibrary?.file) return;
                try {
                    pushBtn.style.opacity = "0.5";
                    new Notice("Pushing changes...");
                    await this.plugin.libraryManager.syncBackup(this.selectedLibrary.file.path, "Update library", undefined, true);
                    new Notice("Successfully pushed changes");
                } catch (e) {
                    new Notice(`Push failed: ${e.message}`);
                } finally {
                    pushBtn.style.opacity = "1";
                }
            });
        }

        const pullBtn = controlsArea.createDiv({ 
            cls: "af-status-control af-status-sync-btn clickable-icon", 
            attr: { "aria-label": "Pull updates from remote" } 
        });
        const pullIconContainer = pullBtn.createDiv({ cls: "af-status-sync-icon" });
        setIcon(pullIconContainer, "refresh-cw");
        const pullBadge = pullIconContainer.createDiv({ cls: "af-status-sync-badge pull-badge is-hidden" });

        pullBtn.addEventListener("click", async () => {
            if (!this.selectedLibrary?.file) return;
            try {
                pullBtn.style.opacity = "0.5";
                new Notice("Updating library...");
                await this.plugin.libraryManager.updateLibrary(this.selectedLibrary.file.path);
                new Notice("Library updated");
                void this.refreshLibraryTree();
            } catch (e) {
                new Notice(`Update failed: ${e.message}`);
            } finally {
                pullBtn.style.opacity = "1";
            }
        });

        if (this.scopeUnsubscribe) {
            this.scopeUnsubscribe();
            this.scopeUnsubscribe = null;
        }

        const scopeId = this.selectedLibrary?.file?.path;
        if (scopeId) {
            const absPath = (this.plugin.libraryManager as any).getAbsolutePath(scopeId);
            this.plugin.libraryManager.scopeManager.registerScope(scopeId, absPath);

            this.scopeUnsubscribe = this.plugin.libraryManager.scopeManager.subscribe(scopeId, (state) => {
                if (this.isOwner) {
                    const pushIcon = toolbar.querySelector(".af-status-sync-icon .af-status-sync-badge.push-badge") as HTMLElement | null;
                    if (!pushIcon && (state.localChanges > 0 || state.ahead > 0)) {
                        const parent = toolbar.querySelectorAll(".af-status-sync-icon")[0] as HTMLElement | undefined;
                        if (parent) {
                            const badge = parent.createDiv({ cls: "af-status-sync-badge push-badge" });
                            badge.style.backgroundColor = "var(--color-blue)";
                            const count = state.localChanges + state.ahead;
                            badge.textContent = count > 9 ? "9+" : String(count);
                        }
                    } else if (pushIcon) {
                        const count = state.localChanges + state.ahead;
                        if (count > 0) {
                            pushIcon.textContent = count > 9 ? "9+" : String(count);
                            pushIcon.removeClass("is-hidden");
                        } else {
                            pushIcon.addClass("is-hidden");
                        }
                    }
                }
            });
        }
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
        void this.debouncedRefreshLibraryTree();
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
        if (this.scopeUnsubscribe) {
            this.scopeUnsubscribe();
            this.scopeUnsubscribe = null;
        }
        this.currentItems = [];
    }
}
