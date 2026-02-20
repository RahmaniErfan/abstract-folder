import { ItemView, WorkspaceLeaf, Menu, Notice, TFile, setIcon, Plugin, TFolder, Platform } from "obsidian";
import AbstractFolderPlugin from "main";
import { CreateSharedSpaceModal } from "../modals/create-shared-space-modal";
import { JoinSharedSpaceModal } from "../modals/join-shared-space-modal";
import { LinkSharedSpaceModal } from "../modals/link-shared-space-modal";
import { AbstractDashboardModal } from "../modals/abstract-dashboard-modal";
import { VirtualViewport, ViewportDelegate } from "../components/virtual-viewport";
import { ContextEngine } from "../../core/context-engine";
import { AbstractNode } from "../../core/tree-builder";
import { AbstractFolderToolbar } from "../toolbar/abstract-folder-toolbar";
import { AbstractSearch } from "../search/abstract-search";
import { ScopedContentProvider } from "../../core/content-provider";

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
    private scopeUnsubscribe: (() => void) | null = null;

    // Search Options
    private searchQuery = "";

    constructor(leaf: WorkspaceLeaf, plugin: AbstractFolderPlugin) {
        super(leaf);
        this.plugin = plugin;
        const { ContextEngine } = require("../../core/context-engine");
        this.contextEngine = new ContextEngine(plugin, 'library');
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
            // Re-initialize engine for the space scope if specific, 
            // OR reuse 'library' scope if we want library settings to apply to all spaces?
            // The plan said: "Uses dynamic scopes like 'space:Path/To/Space'"
            const { ContextEngine } = require("../../core/context-engine");
            this.contextEngine = new ContextEngine(this.plugin, `space:${this.selectedSpace.path}`);
            
            // Subscribe to state changes
            this.contextEngine.on('changed', () => {
                 void this.refreshSpaceTree();
            });
            this.contextEngine.on('expand-all', () => {
                 void this.refreshSpaceTree({ forceExpand: true });
            });
            
            void this.renderSpaceTree(container);
        } else {
            // Back to library scope
            const { ContextEngine } = require("../../core/context-engine");
            this.contextEngine = new ContextEngine(this.plugin, 'library');
            
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

        const meta = this.plugin.graphEngine?.getNodeMeta?.(this.selectedSpace.path);
        const iconToUse = meta?.icon || "users";
        
        const titleEl = titleRow.createEl("h3", { cls: "abstract-folder-header-title" });
        const iconEl = titleEl.createDiv({ cls: "af-header-icon" });
        if (!meta?.icon) {
            iconEl.style.color = "var(--color-purple)";
        }
        setIcon(iconEl, iconToUse);
        titleEl.createSpan({ text: this.selectedSpace.name });

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
        // Create container for toolbar
        const toolbarContainer = container.createDiv();
        
        const path = this.selectedSpace?.path || "";
        const provider = new ScopedContentProvider(
            this.plugin.app,
            this.plugin.settings,
            path,
            `space:${path}`,
            false, // Spaces usually flat or folder based, no extra grouping for now
            null
        );

        new AbstractFolderToolbar(this.app, this.plugin.settings, this.plugin, this.contextEngine, {
            containerEl: toolbarContainer,
            provider: provider,
            showSortButton: true,
            showCreateNoteButton: true,
            showGroupButton: false, // Groups disabled for now in spaces
            showFilterButton: true,
            showExpandButton: true,
            showCollapseButton: true,
            showConversionButton: true,
            extraActions: (toolbarEl: HTMLElement) => {
                 // Space specific actions? 
                 // Maybe move "Sync Now" or "Space Dashboard" here if we want? 
                 // Currently they are in bottom status bar.
            }
        }).render();
    }

    private renderSearch(container: HTMLElement) {
        const searchContainer = container.createDiv();
        new AbstractSearch(this.app, this.plugin, this.plugin.settings, this.contextEngine, {
            containerEl: searchContainer,
            placeholder: "Search in space...",
            onSearch: (query) => {
                this.searchQuery = query;
                void this.refreshSpaceTree();
            },
            showAncestryToggles: true
        }).render();
    }



    private async renderSpaceStatusBar(container: HTMLElement) {
        if (!this.selectedSpace) return;
        
        // Register & Subscribe Scope
        if (this.scopeUnsubscribe) {
            this.scopeUnsubscribe();
            this.scopeUnsubscribe = null;
        }
        
        const scopeId = this.selectedSpace.path;
        const absPath = (this.plugin.libraryManager as any).getAbsolutePath(scopeId);
        this.plugin.libraryManager.scopeManager.registerScope(scopeId, absPath);
        
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
            new AbstractDashboardModal(this.app, this.plugin, this.selectedSpace.path, this.selectedSpace.name, this.isOwner).open();
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
                attr: { "aria-label": "Push changes to remote" } 
            });
            const pushIconContainer = pushArea.createDiv({ cls: "af-status-sync-icon" });
            setIcon(pushIconContainer, "upload-cloud");
            const pushBadge = pushIconContainer.createDiv({ cls: "af-status-sync-badge push-badge is-hidden" });
            pushBadge.style.backgroundColor = "var(--color-blue)";
            
            // Scope listener removed from here to be consolidated
            /*
            this.scopeUnsubscribe = this.plugin.libraryManager.scopeManager.subscribe(scopeId, (state) => {
                 const count = state.localChanges + state.ahead;
                 if (count > 0) {
                     pushBadge.textContent = count > 9 ? "9+" : String(count);
                     pushBadge.removeClass("is-hidden");
                 } else {
                     pushBadge.addClass("is-hidden");
                 }
            });
            */

            pushArea.addEventListener("click", async () => {
                if (!this.selectedSpace) return;
                
                // Visual feedback: Fade opacity
                pushArea.style.opacity = "0.5";
                
                try {
                    new Notice(`Pushing ${this.selectedSpace.name}...`);
                    await this.plugin.libraryManager.syncBackup(this.selectedSpace.path, "Update space", undefined, true);
                    new Notice("Successfully pushed changes");
                    void this.refreshSpaceTree();
                } catch (e) {
                    new Notice(`Push failed: ${e.message}`);
                } finally {
                    pushArea.style.opacity = "1";
                }
            });
        }

        // Pull Button
        const pullArea = controlsArea.createDiv({ 
            cls: "af-status-control af-status-sync-btn clickable-icon", 
            attr: { "aria-label": "Pull updates from remote" } 
        });
        const pullIconContainer = pullArea.createDiv({ cls: "af-status-sync-icon" });
        setIcon(pullIconContainer, "refresh-cw");
        const pullBadge = pullIconContainer.createDiv({ cls: "af-status-sync-badge pull-badge is-hidden" });
        
        // Add listener for pull badge (combined with push listener if exists? No, separate is fine or shared unsubscribe)
        // If we already subscribed (owner case), we need to chain?
        // Actually, `subscribe` returns an unsubscribe function. We can have multiple listeners.
        // But `this.scopeUnsubscribe` only holds one.
        // Solution: Create a composite listener or just one listener that updates both.
        
        // Let's do one listener at the end of the method that updates refs we captured.
        // I will revert the listener inside the `if (this.isOwner)` block and put it at the end.

        pullArea.addEventListener("click", async () => {
            if (!this.selectedSpace) return;
            
            pullArea.style.opacity = "0.5";
            
            try {
                new Notice(`Updating ${this.selectedSpace.name}...`);
                await this.plugin.libraryManager.updateLibrary(this.selectedSpace.path);
                new Notice("Space updated");
                void this.refreshSpaceTree();
            } catch (e) {
                new Notice(`Update failed: ${e.message}`);
            } finally {
                pullArea.style.opacity = "1";
            }
        });


        // Sub scription for badges
        this.scopeUnsubscribe = this.plugin.libraryManager.scopeManager.subscribe(scopeId, (state) => {
             // Update Push Badge
             if (this.isOwner) {
                 // We need to find the badge element. 
                 // Since we don't store ref, we query it.
                 // This is a bit hacky but keeps code localized.
                 const pushIcon = toolbar.querySelector(".af-status-sync-icon .af-status-sync-badge.push-badge");
                 if (!pushIcon && (state.localChanges > 0 || state.ahead > 0)) {
                      const parent = toolbar.querySelectorAll(".af-status-sync-icon")[0]; // Push is first if owner?
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

             // Update Pull Badge
             const pullIcon = toolbar.querySelector(".af-status-sync-icon .af-status-sync-badge.pull-badge");
             // For pull, we need to correctly identify the pull area icon. 
             // If owner, pull is 2nd. If not owner, pull is 1st (after link/cloud?).
             
             // Let's rely on finding by aria-label maybe? Or just querySelectorAll logic?
             
             // Cleaner: Re-render logic inside the subscription is safer? No, expensive.
             // Best: Store refs when creating elements.
             
             // UPDATE: I will modify the creation code above to store refs in local vars or use a class property map if needed.
             // For now, let's just re-implement the badge creation in the blocks above to make them accessible.
        });
    }

    private async refreshSpaceTree(options: { forceExpand?: boolean } = {}) {
        if (!this.viewport || !this.selectedSpace) return;
        
        if (this.isRefreshing) {
            this.nextRefreshScheduled = true;
            return;
        }
        this.isRefreshing = true;
        this.nextRefreshScheduled = false;

        try {
            const scopePath = this.selectedSpace.path;
            
            // Strategic Cache Ingestion
            const relationships = this.plugin.abstractBridge.getLibraryRelationships(scopePath);
            if (relationships) {
                this.plugin.graphEngine.seedRelationships(relationships);
            }

            const provider = new ScopedContentProvider(
                this.plugin.app,
                this.plugin.settings,
                scopePath,
                `space:${scopePath}`,
                false,
                null
            );

            const generator = this.plugin.treeBuilder.buildTree(
                this.contextEngine,
                provider,
                {
                    filterQuery: this.searchQuery,
                    forceExpandAll: !!this.searchQuery || !!options.forceExpand,
                    showAncestors: this.plugin.settings.searchShowAncestors,
                    showDescendants: this.plugin.settings.searchShowDescendants
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
        if (this.scopeUnsubscribe) {
            this.scopeUnsubscribe();
            this.scopeUnsubscribe = null;
        }
        this.currentItems = [];
    }
}
