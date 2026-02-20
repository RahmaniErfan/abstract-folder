import { ItemView, WorkspaceLeaf, TFile, Notice, Platform, setIcon, debounce } from "obsidian";
import type AbstractFolderPlugin from "main";
import { VirtualViewport, ViewportDelegate } from "../components/virtual-viewport";
import { AbstractFolderViewToolbar } from "../toolbar/abstract-folder-view-toolbar";
import { AbstractFolderStatusBar } from "./abstract-folder-status-bar";
import { TreeSnapshot, AbstractNode } from "../../core/tree-builder";
import { Logger } from "../../utils/logger";
import { AbstractSearch } from "../search/abstract-search";
import { GlobalContentProvider } from "../../core/content-provider";

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

export class AbstractFolderView extends ItemView implements ViewportDelegate {
    private plugin: AbstractFolderPlugin;
    private viewport: VirtualViewport;
    private toolbar: AbstractFolderViewToolbar;
    private statusBar: AbstractFolderStatusBar;
    private currentSnapshot: TreeSnapshot | null = null;
    private isRefreshing = false;
    private nextRefreshScheduled = false;
    private contextEngine: import("../../core/context-engine").ContextEngine;
    private debouncedRefreshTree: (options?: { forceExpand?: boolean, repair?: boolean }) => void;

    constructor(leaf: WorkspaceLeaf, plugin: AbstractFolderPlugin) {
        super(leaf);
        this.plugin = plugin;
        // Initialize local context engine for global scope
        const { ContextEngine } = require("../../core/context-engine");
        this.contextEngine = new ContextEngine(plugin, 'global');
        
        this.debouncedRefreshTree = debounce(this.refreshTree.bind(this), 20);
    }

    getViewType(): string {
        return VIEW_TYPE_ABSTRACT_FOLDER;
    }

    getDisplayText(): string {
        return "Abstract folders";
    }

    getIcon(): string {
        return "folder-tree";
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("abstract-folder-view");

        this.renderHeader();

        // Viewport Container
        const scrollContainer = contentEl.createDiv({ cls: "abstract-folder-viewport-scroll-container" });
        // Ensure standard Obsidian scroll behavior
        scrollContainer.addClass("nav-files-container");
        
        const spacerEl = scrollContainer.createDiv({ cls: "abstract-folder-viewport-spacer" });
        const rowsContainer = scrollContainer.createDiv({ cls: "abstract-folder-viewport-rows" });
        
        this.viewport = new VirtualViewport(
            rowsContainer,
            scrollContainer,
            spacerEl,
            this.contextEngine,
            this.plugin.scopeProjector,
            this
        );

        // Subscribe to general context changes
        this.contextEngine.on('changed', () => {
            this.debouncedRefreshTree();
        });

        this.contextEngine.on('expand-all', () => {
             this.debouncedRefreshTree({ forceExpand: true });
        });

        // Subscribe to graph changes to snapshot state and repair URIs
        this.registerEvent(this.app.workspace.on('abstract-folder:graph-updated' as any, () => {
            // 0. Update Header (Visibility might have changed)
            this.renderHeader();

            // 1. Snapshot physical paths BEFORE rebuilding the tree
            if (this.currentSnapshot?.locationMap) {
                this.contextEngine.snapshotPhysicalPaths(this.currentSnapshot.locationMap);
            }
            // 2. Refresh the tree with silent repair
            this.debouncedRefreshTree({ repair: true });
        }));

        this.registerEvent(
            (this.app.workspace as any).on('abstract-folder:git-refreshed', async (vaultPath?: string) => {
                // Update file statuses if the vault root repository refreshed
                if (this.currentSnapshot && this.viewport && vaultPath === "") {
                    // 1. Fetch the fresh matrix for the vault root
                    const matrix = await this.plugin.libraryManager.getFileStatuses("");
                    
                    // 2. Update the syncStatus on our current flat list of nodes
                    for (const node of this.currentSnapshot.items) {
                        const status = matrix.get(node.id);
                        node.syncStatus = status || undefined;
                    }
                    
                    // 3. Command the VirtualViewport to surgically repaint only what's on screen
                    this.viewport.forceUpdateVisibleRows();
                }
            })
        );

        // Initial refresh of the tree on view open
        Logger.debug("[Abstract Folder] View: Initial refreshTree starting during onOpen...");
        await this.refreshTree();

        // 3. Status Bar (Bottom)
        this.statusBar = new AbstractFolderStatusBar(this.app, this.plugin.settings, this.plugin, contentEl);
    }

    private renderHeader() {
        const { contentEl } = this;
        let headerEl = contentEl.querySelector(".abstract-folder-header") as HTMLElement;
        if (!headerEl) {
            headerEl = contentEl.createDiv({ cls: "abstract-folder-header" });
            // Prepend if content already has children
            if (contentEl.firstChild && contentEl.firstChild !== headerEl) {
                contentEl.insertBefore(headerEl, contentEl.firstChild);
            }
        }
        headerEl.empty();

        const visibility = this.plugin.settings.visibility.default;

        // Toolbar
        const toolbarEl = headerEl.createDiv({ cls: "abstract-folder-toolbar" });
        this.toolbar = new AbstractFolderViewToolbar(
            this.app,
            this.plugin.settings,
            this.plugin,
            this.contextEngine,
            toolbarEl,
            () => this.focusSearch(),
            () => this.focusActiveFile()
        );
        this.toolbar.setupToolbarActions();

        if (visibility.showSearchHeader) {
            const searchContainer = headerEl.createDiv({ cls: "abstract-folder-search-container" });
            new AbstractSearch(this.app, this.plugin, this.plugin.settings, this.contextEngine, {
                containerEl: searchContainer,
                placeholder: "Search notes...",
                onSearch: (query) => {
                    Logger.debug(`[Abstract Folder] View: Search input changed to "${query}"`);
                },
                showAncestryToggles: true
            }).render();
        }
    }

    async onClose() {
        if (this.viewport) {
            this.viewport.destroy();
        }
    }

    getItemHeight(): number {
        return 24;
    }

    isMobile(): boolean {
        return Platform.isMobile;
    }

    private updateStatus() {
        if (this.statusBar) {
            void this.statusBar.refreshStatus();
        }
    }

    public focusSearch() {
        const searchInput = this.contentEl.querySelector('.abstract-folder-search-input') as HTMLInputElement;
        if (searchInput) {
            searchInput.focus();
        }
    }

    public focusFile(path: string) {
        // Logic to highlight/focus a specific path
        const snapshot = this.currentSnapshot;
        if (snapshot) {
            const matchingNode = snapshot.items.find(item => item.id === path);
            if (matchingNode) {
                this.contextEngine.select(matchingNode.uri, { multi: false });
                this.viewport.scrollToItem(matchingNode.uri);
            }
        }
    }

    public async focusActiveFile() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        this.focusFile(activeFile.path);
    }

    onItemClick(node: AbstractNode, event: MouseEvent): void {
        const isMulti = event.ctrlKey || event.metaKey;
        const isRange = event.shiftKey;

        // Update selection state in context
        this.contextEngine.select(node.uri, {
            multi: isMulti,
            range: isRange,
            flatList: this.currentSnapshot?.items.map(n => n.uri)
        });

        // 2. Open File if it's a single click (no modifier or just range)
        const file = this.app.vault.getAbstractFileByPath(node.id);
        if (file instanceof TFile && !isMulti) {
            void this.app.workspace.getLeaf(false).openFile(file);
        }
    }

    onItemToggle(node: AbstractNode, event: MouseEvent): void {
        this.contextEngine.toggleExpand(node.uri);
    }

    onItemContextMenu(node: AbstractNode, event: MouseEvent): void {
        if (!this.currentSnapshot) return;
        this.plugin.contextMenuHandler.showV2ContextMenu(
            event,
            node,
            this.contextEngine.getState().selectedURIs,
            this.currentSnapshot.items
        );
    }

    onItemDrop(draggedPath: string, targetNode: AbstractNode): void {
        const draggedFile = this.app.vault.getAbstractFileByPath(draggedPath);
        if (!(draggedFile instanceof TFile)) return;

        this.plugin.transactionManager.moveNode(draggedFile, targetNode.id)
            .then(() => {
                new Notice(`Moved ${draggedFile.basename} to ${targetNode.name}`);
                this.debouncedRefreshTree({ repair: true });
            })
            .catch((error) => {
                console.error("Failed to move node", error);
                new Notice("Failed to move node. See console for details.");
            });
    }

    private async refreshTree(options: { forceExpand?: boolean, repair?: boolean } = {}) {
        if (this.isRefreshing) {
            this.nextRefreshScheduled = true;
            return;
        }
        this.isRefreshing = true;
        this.nextRefreshScheduled = false;

        try {
            const state = this.contextEngine.getState();
            const filterQuery = state.activeFilter;

            const provider = new GlobalContentProvider(this.app, this.plugin.settings, state.activeGroupId);
            
            const generator = this.plugin.treeBuilder.buildTree(
                this.contextEngine,
                provider,
                {
                    filterQuery: filterQuery,
                    forceExpandAll: !!filterQuery || !!options.forceExpand // Force expand all if searching OR requested
                }
            );
            while (true) {
                const result = await generator.next();
                if (result.done) {
                    this.currentSnapshot = result.value;
                    break;
                }
            }

            // Perform state repair if requested before updating the viewport
            if (options.repair && this.currentSnapshot) {
                this.contextEngine.repairState(this.currentSnapshot.locationMap, { silent: true });
            }

            if (this.currentSnapshot) {
                Logger.debug(`[Abstract Folder] View: Updating viewport with ${this.currentSnapshot.items.length} items`);
                this.viewport.setItems(this.currentSnapshot.items);
            }
            if (this.statusBar) {
                Logger.debug("[Abstract Folder] View: Refreshing status bar");
                this.statusBar.refreshStatus();
            }
        } catch (error) {
            console.error("Failed to refresh tree", error);
        } finally {
            this.isRefreshing = false;
            // Logger.debug("[Abstract Folder] View: refreshTree finished");
            if (this.nextRefreshScheduled) {
                Logger.debug("[Abstract Folder] View: Next refresh was scheduled, re-triggering...");
                this.nextRefreshScheduled = false;
                void this.refreshTree(options);
            }
        }
    }
}
