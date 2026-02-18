import { ItemView, WorkspaceLeaf, Menu, Notice, TFile, setIcon, Plugin, TFolder, Platform } from "obsidian";
import AbstractFolderPlugin from "main";
import { CreateSharedSpaceModal } from "../modals/create-shared-space-modal";
import { JoinSharedSpaceModal } from "../modals/join-shared-space-modal";
import { LinkSharedSpaceModal } from "../modals/link-shared-space-modal";
import { SpaceDashboardModal } from "../modals/space-dashboard-modal";
import { VirtualViewport, ViewportDelegate } from "../components/virtual-viewport";
import { ContextEngine } from "../../core/context-engine";
import { AbstractNode } from "../../core/tree-builder";

export const ABSTRACT_SPACES_VIEW_TYPE = "abstract-spaces-explorer";

export class AbstractSpacesExplorerView extends ItemView implements ViewportDelegate {
    private plugin: AbstractFolderPlugin;
    private viewport: VirtualViewport | null = null;
    private contextEngine: ContextEngine;
    private selectedSpace: TFolder | null = null;
    private currentItems: AbstractNode[] = [];
    private isRefreshing = false;
    private nextRefreshScheduled = false;
    private repositoryUrl: string | null = null;
    private authorName = "Unknown";
    private isOwner = false;

    // Search Options
    private showAncestors = true;
    private showDescendants = true;
    private searchQuery = "";
    private searchInput: HTMLInputElement;
    private clearSearchBtn: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: AbstractFolderPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.contextEngine = new ContextEngine(plugin.settings);
    }

    getViewType() {
        return ABSTRACT_SPACES_VIEW_TYPE;
    }

    getDisplayText() {
        return "Abstract Spaces";
    }

    getIcon() {
        return "users";
    }

    async onOpen() {
        this.renderView();

        // Listen for updates
        this.registerEvent(
            (this.app.workspace as any).on("abstract-folder:spaces-updated", () => {
                this.renderView();
            })
        );
        
        // Listen for graph updates (e.g. new files) to refresh the tree
        this.registerEvent(
            (this.app.workspace as any).on("abstract-folder:graph-updated", () => {
                if (this.selectedSpace) {
                    void this.refreshSpaceTree();
                } else {
                    this.renderView();
                }
            })
        );
    }

    private renderView() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("abstract-library-explorer");

        if (this.selectedSpace) {
            void this.renderSpaceTree(container);
        } else {
            void this.renderShelf(container);
        }
    }

    private async renderShelf(container: HTMLElement) {
        this.renderShelfHeader(container);

        const listContainer = container.createDiv({ cls: "nav-files-container" });
        listContainer.style.position = "relative";
        
        const spacesRoot = this.plugin.settings.librarySettings.sharedSpacesRoot || "Abstract Spaces";
        const rootFolder = this.app.vault.getAbstractFileByPath(spacesRoot);

        if (!rootFolder || !(rootFolder as any).children || (rootFolder as any).children.length === 0) {
            const emptyState = listContainer.createDiv({ cls: "pane-empty" });
            emptyState.setText("No shared spaces yet.\nCreate or join one to get started!");
            emptyState.style.whiteSpace = "pre";
            emptyState.style.textAlign = "center";
            emptyState.style.padding = "20px";
            emptyState.style.color = "var(--text-muted)";
            return;
        }

        const shelfContainer = listContainer.createDiv({ cls: "library-shelf" });
        const cardContainer = shelfContainer.createDiv({ cls: "library-card-container" });

        const children = (rootFolder as any).children;
        for (const child of children) {
            if (child instanceof TFile) continue;

            const card = cardContainer.createDiv({ cls: "library-explorer-card" });
            const iconContainer = card.createDiv({ cls: "library-card-icon" });
            setIcon(iconContainer, "users");
            iconContainer.style.color = "var(--color-purple)";
            
            const info = card.createDiv({ cls: "library-card-info" });
            info.createDiv({ cls: "library-card-name", text: child.name });
            
            card.addEventListener("click", () => {
                this.selectedSpace = child as TFolder;
                this.renderView();
            });

            // Context Menu for management
            card.addEventListener("contextmenu", (event) => {
                const menu = new Menu();
                menu.addItem((item) =>
                    item
                        .setTitle("Sync Now")
                        .setIcon("refresh-cw")
                        .onClick(async () => {
                            new Notice(`Syncing ${child.name}...`);
                            try {
                                await this.plugin.libraryManager.syncBackup(child.path, "Manual sync from Explorer");
                            } catch (e) {
                                new Notice("Sync failed. Check console.");
                                console.error(e);
                            }
                        })
                );
                menu.addItem((item) =>
                    item
                        .setTitle("Copy Invite Link")
                        .setIcon("link")
                        .onClick(async () => {
                            const remote = await this.plugin.libraryManager.getRemoteUrl(child.path);
                            if (remote) {
                                navigator.clipboard.writeText(remote);
                                new Notice("Copied invite link to clipboard!");
                            } else {
                                new Notice("No remote URL found for this space.");
                            }
                        })
                );
                menu.showAtMouseEvent(event);
            });
        }
    }

    private renderShelfHeader(container: HTMLElement) {
        const header = container.createDiv({ cls: "abstract-folder-header" });
        const titleRow = header.createDiv({ cls: "abstract-folder-header-title-container" });
        titleRow.createEl("h3", { cls: "abstract-folder-header-title", text: "Abstract Spaces" });

        const toolbar = header.createDiv({ cls: "abstract-folder-toolbar" });
        
        const newSpaceBtn = toolbar.createDiv({ cls: "abstract-folder-toolbar-action clickable-icon", attr: { "aria-label": "Create New Space" } });
        setIcon(newSpaceBtn, "plus-circle");
        newSpaceBtn.addEventListener("click", () => {
             new CreateSharedSpaceModal(this.app, this.plugin).open();
        });

        const joinSpaceBtn = toolbar.createDiv({ cls: "abstract-folder-toolbar-action clickable-icon", attr: { "aria-label": "Join Shared Space" } });
        setIcon(joinSpaceBtn, "link");
        joinSpaceBtn.addEventListener("click", () => {
             new JoinSharedSpaceModal(this.app, this.plugin).open();
        });

        header.createDiv({ cls: "library-header-divider" });
    }

    private async renderSpaceTree(container: HTMLElement) {
        if (!this.selectedSpace) return;

        const header = container.createDiv({ cls: "abstract-folder-header" });
        
        const titleRow = header.createDiv({ cls: "abstract-folder-header-title-container" });
        const backBtn = titleRow.createDiv({ cls: "af-header-back-button abstract-folder-toolbar-action clickable-icon", attr: { "aria-label": "Back to shelf" } });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => {
            if (this.viewport) {
                this.viewport.destroy();
                this.viewport = null;
            }
            this.selectedSpace = null;
            this.renderView();
        });

        titleRow.createEl("h3", { text: this.selectedSpace.name, cls: "abstract-folder-header-title" });

        // Pre-fetch ownership and repo info for toolbars
        const status = await this.plugin.libraryManager.isLibraryOwner(this.selectedSpace.path);
        this.isOwner = status.isOwner;
        this.authorName = status.author;
        this.repositoryUrl = status.repositoryUrl;

        this.renderTopToolbar(header);
        this.renderSearch(header);

        header.createDiv({ cls: "library-header-divider" });

        const treeContainer = container.createDiv({ cls: "abstract-folder-tree-container" });
        const scrollContainer = treeContainer.createDiv({ cls: "abstract-folder-viewport-scroll-container nav-files-container" });
        const spacerEl = scrollContainer.createDiv({ cls: "abstract-folder-viewport-spacer" });
        const contentEl = scrollContainer.createDiv({ cls: "abstract-folder-viewport-rows" });

        await this.renderSpaceStatusBar(container);

        this.viewport = new VirtualViewport(
            contentEl,
            scrollContainer,
            spacerEl,
            this.contextEngine,
            this.plugin.scopeProjector,
            this,
            { showGroupHeader: false }
        );
        await this.refreshSpaceTree();
    }

    private renderTopToolbar(container: HTMLElement) {
        const toolbar = container.createDiv({ cls: "abstract-folder-toolbar" });

        // Sort Button
        const sortBtn = toolbar.createDiv({ 
            cls: "abstract-folder-toolbar-action clickable-icon", 
            attr: { "aria-label": "Change sort order" } 
        });
        setIcon(sortBtn, "arrow-up-down");
        sortBtn.addEventListener("click", (evt) => {
            const menu = new Menu();
            const currentSort = this.contextEngine.getState().sortConfig;
            
            const sortOptions = [
                { label: "File name (A to Z)", sortBy: "name", sortOrder: "asc" },
                { label: "File name (Z to A)", sortBy: "name", sortOrder: "desc" },
                { label: "Modified time (new to old)", sortBy: "modified", sortOrder: "desc" },
                { label: "Modified time (old to new)", sortBy: "modified", sortOrder: "asc" },
                { label: "Created time (new to old)", sortBy: "created", sortOrder: "desc" },
                { label: "Created time (old to new)", sortBy: "created", sortOrder: "asc" }
            ];

            sortOptions.forEach(opt => {
                menu.addItem((item) => {
                    item.setTitle(opt.label)
                        .setChecked(currentSort.sortBy === opt.sortBy && currentSort.sortOrder === opt.sortOrder)
                        .onClick(() => {
                            this.contextEngine.setSortConfig({
                                sortBy: opt.sortBy as any, 
                                sortOrder: opt.sortOrder as any
                            });
                            void this.refreshSpaceTree();
                        });
                });
            });
            menu.showAtMouseEvent(evt);
        });

        // New Note Button
        const newNoteBtn = toolbar.createDiv({ 
            cls: "abstract-folder-toolbar-action clickable-icon", 
            attr: { "aria-label": "New note" } 
        });
        setIcon(newNoteBtn, "file-plus");
        newNoteBtn.addEventListener("click", async () => {
            if (!this.selectedSpace) return;
            const newFile = await this.app.vault.create(
                `${this.selectedSpace.path}/Untitled.md`, 
                ""
            );
            await this.app.workspace.getLeaf(false).openFile(newFile);
        });

        // New Folder Button
        const newFolderBtn = toolbar.createDiv({ 
            cls: "abstract-folder-toolbar-action clickable-icon", 
            attr: { "aria-label": "New folder" } 
        });
        setIcon(newFolderBtn, "folder-plus");
        newFolderBtn.addEventListener("click", async () => {
            if (!this.selectedSpace) return;
            await this.app.vault.createFolder(`${this.selectedSpace.path}/New Folder`);
        });
    }

    private renderSearch(container: HTMLElement) {
        const searchContainer = container.createDiv({ cls: "abstract-folder-search-container" });
        const wrapper = searchContainer.createDiv({ cls: "abstract-folder-search-input-wrapper" });
        
        this.searchInput = wrapper.createEl("input", {
            type: "text",
            placeholder: "Search in space...",
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
            this.contextEngine.setFilter(this.searchQuery);
            this.updateClearButtonState();
            void this.refreshSpaceTree();
        });

        this.clearSearchBtn.addEventListener("click", () => {
            this.searchQuery = "";
            this.searchInput.value = "";
            this.contextEngine.setFilter("");
            this.updateClearButtonState();
            this.searchInput.focus();
            void this.refreshSpaceTree();
        });

        const showAncestorsBtn = searchContainer.createDiv({
            cls: "clickable-icon ancestry-search-toggle",
            attr: { "aria-label": "Show all ancestors in search" }
        });
        setIcon(showAncestorsBtn, "arrow-up-left");
        if (this.showAncestors) showAncestorsBtn.addClass("is-active");

        showAncestorsBtn.addEventListener("click", () => {
            this.showAncestors = !this.showAncestors;
            showAncestorsBtn.toggleClass("is-active", this.showAncestors);
            void this.refreshSpaceTree();
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
            void this.refreshSpaceTree();
        });
    }

    private updateClearButtonState() {
        if (!this.clearSearchBtn) return;
        this.clearSearchBtn.toggleClass("is-active", this.searchQuery.length > 0);
    }

    private async renderSpaceStatusBar(container: HTMLElement) {
        if (!this.selectedSpace) return;
        
        const isLinked = !!this.repositoryUrl;

        const toolbar = container.createDiv({ cls: "af-status-bar" });
        const identityArea = toolbar.createDiv({ cls: "af-status-identity" });
        
        const spaceIcon = identityArea.createDiv({ cls: "af-status-library-icon" });
        setIcon(spaceIcon, "users");
        spaceIcon.style.color = "var(--color-purple)";

        const infoArea = identityArea.createDiv({ cls: "library-bottom-info-row" });
        infoArea.createSpan({ cls: "af-status-username", text: this.selectedSpace.name });

        if (!isLinked) {
            infoArea.createDiv({ 
                cls: "library-access-badge-pill is-readonly", 
                text: "Local Only",
                attr: { "aria-label": "This space is not linked to a remote repository" }
            });
        } else {
            infoArea.createDiv({ 
                cls: `library-access-badge-pill ${this.isOwner ? 'is-owner' : 'is-readonly'}`,
                text: this.isOwner ? "Owner" : "Read-only"
            });
        }

        const controlsArea = toolbar.createDiv({ cls: "af-status-controls" });

        // Cloud icon for dashboard/settings
        const dashboardBtn = controlsArea.createDiv({ 
            cls: "af-status-control clickable-icon", 
            attr: { "aria-label": "Space Info & Settings" } 
        });
        setIcon(dashboardBtn, "cloud");
        dashboardBtn.addEventListener("click", () => {
            if (!this.selectedSpace) return;
            new SpaceDashboardModal(this.app, this.plugin, this.selectedSpace, this.isOwner).open();
        });

        if (!isLinked) {
            const linkArea = controlsArea.createDiv({ 
                cls: "af-status-control af-status-sync-btn clickable-icon", 
                attr: { "aria-label": "Link & Publish Space" } 
            });
            setIcon(linkArea, "upload-cloud");
            linkArea.addEventListener("click", () => {
                if (!this.selectedSpace) return;
                new LinkSharedSpaceModal(
                    this.app, 
                    this.plugin, 
                    this.selectedSpace.path, 
                    this.selectedSpace.name, 
                    () => {
                        this.renderView();
                    }
                ).open();
            });
            return;
        }

        // Push Button (Owners only)
        if (this.isOwner) {
            const pushArea = controlsArea.createDiv({ 
                cls: "af-status-control af-status-sync-btn clickable-icon", 
                attr: { "aria-label": "Push changes" } 
            });
            const pushIconContainer = pushArea.createDiv({ cls: "af-status-sync-icon" });
            setIcon(pushIconContainer, "arrow-up-circle");

            pushArea.addEventListener("click", async () => {
                if (!this.selectedSpace) return;
                pushArea.addClass("is-syncing");
                try {
                    new Notice(`Pushing ${this.selectedSpace.name}...`);
                    await this.plugin.libraryManager.syncBackup(this.selectedSpace.path, "Update space", undefined, true);
                    new Notice("Successfully pushed changes");
                    void this.refreshSpaceTree();
                } catch (e) {
                    new Notice(`Push failed: ${e.message}`);
                } finally {
                    pushArea.removeClass("is-syncing");
                }
            });
        }

        // Pull Button
        const pullArea = controlsArea.createDiv({ 
            cls: "af-status-control af-status-sync-btn clickable-icon", 
            attr: { "aria-label": "Pull updates" } 
        });
        const pullIconContainer = pullArea.createDiv({ cls: "af-status-sync-icon" });
        setIcon(pullIconContainer, "refresh-cw");

        pullArea.addEventListener("click", async () => {
            if (!this.selectedSpace) return;
            pullArea.addClass("is-syncing");
            try {
                new Notice(`Updating ${this.selectedSpace.name}...`);
                await this.plugin.libraryManager.updateLibrary(this.selectedSpace.path);
                new Notice("Space updated");
                void this.refreshSpaceTree();
            } catch (e) {
                new Notice(`Update failed: ${e.message}`);
            } finally {
                pullArea.removeClass("is-syncing");
            }
        });
    }

    private async refreshSpaceTree() {
        if (!this.viewport || !this.selectedSpace) return;
        
        if (this.isRefreshing) {
            this.nextRefreshScheduled = true;
            return;
        }
        this.isRefreshing = true;
        this.nextRefreshScheduled = false;

        try {
            const scopePath = this.selectedSpace.path;
            const generator = this.plugin.treeBuilder.buildTree(
                this.contextEngine, 
                this.searchQuery, 
                !!this.searchQuery, 
                scopePath,
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
            console.error("SpacesExplorerView: Failed to refresh tree", error);
        } finally {
            this.isRefreshing = false;
            if (this.nextRefreshScheduled) {
                this.nextRefreshScheduled = false;
                void this.refreshSpaceTree();
            }
        }
    }

    // ViewportDelegate implementation
    getItemHeight(): number { return 24; }
    isMobile(): boolean { return Platform.isMobile; }

    onItemClick(node: AbstractNode, event: MouseEvent): void {
        this.contextEngine.select(node.uri, { multi: event.ctrlKey || event.metaKey });
        const file = this.app.vault.getAbstractFileByPath(node.id);
        if (file instanceof TFile) {
            void this.app.workspace.getLeaf(false).openFile(file);
        }
    }

    onItemToggle(node: AbstractNode, event: MouseEvent): void {
        this.contextEngine.toggleExpand(node.uri);
        void this.refreshSpaceTree();
    }

    onItemContextMenu(node: AbstractNode, event: MouseEvent): void {
        const selection = this.contextEngine.getState().selectedURIs;
        this.plugin.contextMenuHandler.showV2ContextMenu(
            event,
            node,
            selection,
            this.currentItems
        );
    }

    onItemDrop(draggedPath: string, targetNode: AbstractNode): void {
        // Shared spaces D&D logic could be added here
    }

    async onClose() {
        if (this.viewport) {
            this.viewport.destroy();
            this.viewport = null;
        }
        this.currentItems = [];
    }
}
