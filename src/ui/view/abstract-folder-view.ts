import { ItemView, WorkspaceLeaf, TFile, Notice, Platform, setIcon } from "obsidian";
import type AbstractFolderPlugin from "main";
import { VirtualViewport, ViewportDelegate } from "../components/virtual-viewport";
import { AbstractFolderViewToolbar } from "../toolbar/abstract-folder-view-toolbar";
import { AbstractFolderStatusBar } from "./abstract-folder-status-bar";
import { TreeSnapshot, AbstractNode } from "../../core/tree-builder";
import { Logger } from "../../utils/logger";
import { AbstractSearch } from "../search/abstract-search";

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

export class AbstractFolderView extends ItemView implements ViewportDelegate {
    private plugin: AbstractFolderPlugin;
    private viewport: VirtualViewport;
    private toolbar: AbstractFolderViewToolbar;
    private statusBar: AbstractFolderStatusBar;
    private currentSnapshot: TreeSnapshot | null = null;
    private isRefreshing = false;
    private nextRefreshScheduled = false;

    constructor(leaf: WorkspaceLeaf, plugin: AbstractFolderPlugin) {
        super(leaf);
        this.plugin = plugin;
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

        // Header/Search area
        const headerEl = contentEl.createDiv({ cls: "abstract-folder-header" });
        
        // Toolbar
        const toolbarEl = headerEl.createDiv({ cls: "abstract-folder-toolbar" });
        this.toolbar = new AbstractFolderViewToolbar(
            this.app,
            this.plugin.settings,
            this.plugin,
            toolbarEl,
            () => this.focusSearch(),
            () => this.focusActiveFile()
        );
        this.toolbar.setupToolbarActions();

        const searchContainer = headerEl.createDiv({ cls: "abstract-folder-search-container" });
        new AbstractSearch(this.app, this.plugin, this.plugin.settings, this.plugin.contextEngine, {
            containerEl: searchContainer,
            placeholder: "Search notes...",
            onSearch: (query) => {
                 Logger.debug(`[Abstract Folder] View: Search input changed to "${query}"`);
                 // ContextEngine update is handled by AbstractSearch internally
                 // We just need to trigger refresh if not automatically triggered by 'changed' event.
                 // Actually AbstractSearch calls contextEngine.setFilter(query).
                 // ContextEngine emits 'changed', which AbstractFolderView listens to.
                 // So we might not need to do anything here if the listener calls refreshTree.
                 // However, AbstractSearch expects onSearch callback.
                 // Let's check AbstractSearch checks.
                 // AbstractSearch handles UI value.
            },
           showAncestryToggles: true
        }).render();

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
            this.plugin.contextEngine,
            this.plugin.scopeProjector,
            this
        );

        // Subscribe to general context changes
        this.plugin.contextEngine.on('changed', () => {
            void this.refreshTree();
        });

        this.plugin.contextEngine.on('expand-all', () => {
             // We can't efficiently expand every single folder without loading them.
             // But we can trigger a refresh with forceExpandAll=true for the current view.
             // However, `refreshTree` uses `this.plugin.treeBuilder`.
             // Check `refreshTree` signature.
             // It calls `this.plugin.treeBuilder.buildTree(..., forceExpandAll)`.
             // But `forceExpandAll` is currently only true if filterQuery is present.
             // We can add a property `forceExpandOnce` or similar.
             // For now, let's just re-render with a flag if possible, or maybe just `contextEngine` state should have a flag?
             // Actually, the `expand-all` event is a signal.
             // Let's modify `refreshTree` to accept an override?
             // Or better, let's just set a temporary flag.
             void this.refreshTree({ forceExpand: true });
        });

        // Subscribe to graph changes
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        // Subscribe to graph changes
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        this.registerEvent(this.app.workspace.on('abstract-folder:graph-updated' as any, () => {
            // 1. Snapshot physical paths BEFORE rebuilding the tree
            if (this.currentSnapshot?.locationMap) {
                this.plugin.contextEngine.snapshotPhysicalPaths(this.currentSnapshot.locationMap);
            }
            // 2. Refresh the tree with silent repair
            void this.refreshTree({ repair: true });
        }));

        // Initial build
        Logger.debug("[Abstract Folder] View: Initial refreshTree starting during onOpen...");
        await this.refreshTree();
        Logger.debug("[Abstract Folder] View: Initial refreshTree complete.");

        // 3. Status Bar (Bottom)
        this.statusBar = new AbstractFolderStatusBar(this.app, this.plugin.settings, this.plugin, contentEl);
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

    private focusSearch() {
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
                this.plugin.contextEngine.select(matchingNode.uri, { multi: false });
                this.viewport.scrollToItem(matchingNode.uri);
            }
        }
    }

    public async focusActiveFile() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        // 1. Update Search/Filter via ContextEngine (AbstractSearch will react)
        // If we want to filter by name to find it? 
        // Or just expanding to it?
        // Original code set filter to basename.
        this.plugin.contextEngine.setFilter(activeFile.basename);
        
        // 2. Enable Ancestry Toggles in Settings
        this.plugin.settings.searchShowAncestors = true;
        this.plugin.settings.searchShowDescendants = true;
        await this.plugin.saveSettings();

        // 3. Trigger Search & Save (setFilter emits changed, but we also save settings)
        // We might want to force a refresh if setFilter didn't trigger it yet, but it should.
        
        // Reveal in tree logic (V2 migration)
        // We wait for the tree to refresh?
        // setFilter is synchronous in updating state but emits event.
        // refreshTree is async.
        // We might need to wait for refresh to complete to scroll to item.
        // However, we can just try to select it.
        // If it's not in the tree yet, we can't scroll to it.
        
        // If we just set filter, the tree will rebuild.
        // We should wait for rebuild?
        // For now let's just trigger selection and hope it works or rely on subsequent updates.
        // Actually, if we set filter, the view will refresh.
        // We can hook into the next snapshot update?
        // Or we can just let the user see the result.
        
        // Logic to highlight/focus a specific path:
        // We can't find `matchingNode` until tree is rebuilt.
        // The previous code had `this.currentSnapshot` which was STALE at this point if filter just changed.
        // So the previous code was likely buggy or relying on `searchInput.value` change triggering something?
        
        // Let's just set the filter and settings.
        // The tree will update.
        // If we want to ensure selection, we might need a "pending focus" state.
        
        // For now, removing the manual DOM manipulation and button toggling.
    }

    onItemClick(node: AbstractNode, event: MouseEvent): void {
        const isMulti = event.ctrlKey || event.metaKey;
        const isRange = event.shiftKey;

        // 1. Update Selection State
        this.plugin.contextEngine.select(node.uri, {
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
        this.plugin.contextEngine.toggleExpand(node.uri);
        void this.refreshTree();
    }

    onItemContextMenu(node: AbstractNode, event: MouseEvent): void {
        if (!this.currentSnapshot) return;
        this.plugin.contextMenuHandler.showV2ContextMenu(
            event,
            node,
            this.plugin.contextEngine.getState().selectedURIs,
            this.currentSnapshot.items
        );
    }

    onItemDrop(draggedPath: string, targetNode: AbstractNode): void {
        const draggedFile = this.app.vault.getAbstractFileByPath(draggedPath);
        if (!(draggedFile instanceof TFile)) return;

        this.plugin.transactionManager.moveNode(draggedFile, targetNode.id)
            .then(() => {
                new Notice(`Moved ${draggedFile.basename} to ${targetNode.name}`);
                return this.refreshTree({ repair: true });
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
            const state = this.plugin.contextEngine.getState();
            const filterQuery = state.activeFilter;
            
            const generator = this.plugin.treeBuilder.buildTree(
                this.plugin.contextEngine,
                filterQuery,
                !!filterQuery || !!options.forceExpand // Force expand all if searching OR requested
            );
            while (true) {
                const result = await generator.next();
                if (result.done) {
                    this.currentSnapshot = result.value;
                    break;
                }
            }

            // Silent Repair IF requested BEFORE updating viewport
            if (options.repair && this.currentSnapshot) {
                this.plugin.contextEngine.repairState(this.currentSnapshot.locationMap, { silent: true });
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
            Logger.debug("[Abstract Folder] View: refreshTree finished");
            if (this.nextRefreshScheduled) {
                Logger.debug("[Abstract Folder] View: Next refresh was scheduled, re-triggering...");
                this.nextRefreshScheduled = false;
                void this.refreshTree(options);
            }
        }
    }
}
