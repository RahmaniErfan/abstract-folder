import { ItemView, WorkspaceLeaf, Menu, Notice, TFile, setIcon, Plugin, TFolder, Platform } from "obsidian";
import AbstractFolderPlugin from "main";
import { CreateSharedSpaceModal } from "../modals/create-shared-space-modal";
import { JoinSharedSpaceModal } from "../modals/join-shared-space-modal";
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
    }

    private renderView() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("abstract-folder-library-explorer");

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

        header.createDiv({ cls: "library-header-divider" });

        // Toolbar Action Row (Search + Actions)
        const actionRow = header.createDiv({ cls: "library-shelf-search-row" });
        
        // Search Input
        const searchContainer = actionRow.createDiv({ cls: "abstract-folder-search-container" });
        const searchWrapper = searchContainer.createDiv({ cls: "abstract-folder-search-input-wrapper" });
        const searchInput = searchWrapper.createEl("input", {
            type: "text",
            placeholder: "Search in space...",
            cls: "abstract-folder-search-input"
        });
        
        searchInput.addEventListener("input", (e) => {
            const query = (e.target as HTMLInputElement).value;
            this.contextEngine.setFilter(query);
            void this.refreshSpaceTree();
        });

        // Sort Button
        const sortBtn = actionRow.createDiv({ 
            cls: "clickable-icon nav-action-button", 
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
        const newNoteBtn = actionRow.createDiv({ 
            cls: "clickable-icon nav-action-button", 
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
        const newFolderBtn = actionRow.createDiv({ 
            cls: "clickable-icon nav-action-button", 
            attr: { "aria-label": "New folder" } 
        });
        setIcon(newFolderBtn, "folder-plus");
        newFolderBtn.addEventListener("click", async () => {
            if (!this.selectedSpace) return;
            await this.app.vault.createFolder(`${this.selectedSpace.path}/New Folder`);
        });

        header.createDiv({ cls: "library-header-divider" });

        const treeContainer = container.createDiv({ cls: "abstract-folder-tree-container" });
        const scrollContainer = treeContainer.createDiv({ cls: "abstract-folder-viewport-scroll-container nav-files-container" });
        const spacerEl = scrollContainer.createDiv({ cls: "abstract-folder-viewport-spacer" });
        const contentEl = scrollContainer.createDiv({ cls: "abstract-folder-viewport-rows" });

        this.renderSpaceStatusBar(container);

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

    private renderSpaceStatusBar(container: HTMLElement) {
        const toolbar = container.createDiv({ cls: "af-status-bar" });
        const identityArea = toolbar.createDiv({ cls: "af-status-identity" });
        
        const spaceIcon = identityArea.createDiv({ cls: "af-status-library-icon" });
        setIcon(spaceIcon, "users");
        spaceIcon.style.color = "var(--color-purple)";

        const infoArea = identityArea.createDiv({ cls: "library-bottom-info-row" });
        infoArea.createSpan({ cls: "af-status-username", text: this.selectedSpace?.name || "" });

        const controlsArea = toolbar.createDiv({ cls: "af-status-controls" });

        const syncBtn = controlsArea.createDiv({ 
            cls: "af-status-control clickable-icon", 
            attr: { "aria-label": "Sync Space Now" } 
        });
        setIcon(syncBtn, "refresh-cw");
        syncBtn.addEventListener("click", async () => {
            if (!this.selectedSpace) return;
            try {
                new Notice(`Syncing ${this.selectedSpace.name}...`);
                await this.plugin.libraryManager.syncBackup(this.selectedSpace.path, "Manual sync from Space Explorer");
                new Notice("Sync complete");
            } catch (e) {
                new Notice(`Sync failed: ${e.message}`);
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
                null, 
                false, 
                scopePath
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
