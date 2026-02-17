import { ItemView, WorkspaceLeaf, TFile, Notice, Platform, setIcon } from "obsidian";
import type AbstractFolderPlugin from "main";
import { VirtualViewport, ViewportDelegate } from "../components/virtual-viewport";
import { AbstractFolderViewToolbar } from "../toolbar/abstract-folder-view-toolbar";
import { AbstractFolderStatusBar } from "./abstract-folder-status-bar";
import { TreeSnapshot, AbstractNode } from "../../core/tree-builder";
import { Logger } from "../../utils/logger";

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

export class AbstractFolderView extends ItemView implements ViewportDelegate {
    private plugin: AbstractFolderPlugin;
    private viewport: VirtualViewport;
    private toolbar: AbstractFolderViewToolbar;
    private statusBar: AbstractFolderStatusBar;
    private searchInput: HTMLInputElement;
    private showAncestorsBtn: HTMLElement;
    private showDescendantsBtn: HTMLElement;
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

        this.searchInput = headerEl.createEl("input", {
            type: "text",
            placeholder: "Search notes...",
            cls: "abstract-folder-search-input"
        });

        const searchContainer = headerEl.createDiv({ cls: "abstract-folder-search-container" });
        searchContainer.appendChild(this.searchInput);

        const showAncestorsBtn = searchContainer.createDiv({
            cls: "clickable-icon ancestry-search-toggle",
            attr: { "aria-label": "Show all ancestors in search" }
        });
        this.showAncestorsBtn = showAncestorsBtn;
        setIcon(showAncestorsBtn, "arrow-up-left");
        if (this.plugin.settings.searchShowAncestors) showAncestorsBtn.addClass("is-active");

        showAncestorsBtn.addEventListener("click", () => {
            void (async () => {
                this.plugin.settings.searchShowAncestors = !this.plugin.settings.searchShowAncestors;
                showAncestorsBtn.toggleClass("is-active", this.plugin.settings.searchShowAncestors);
                await this.plugin.saveSettings();
                this.plugin.contextEngine.emit('changed', this.plugin.contextEngine.getState());
            })();
        });

        const showDescendantsBtn = searchContainer.createDiv({
            cls: "clickable-icon ancestry-search-toggle",
            attr: { "aria-label": "Show all descendants in search" }
        });
        this.showDescendantsBtn = showDescendantsBtn;
        setIcon(showDescendantsBtn, "arrow-down-right");
        if (this.plugin.settings.searchShowDescendants) showDescendantsBtn.addClass("is-active");

        showDescendantsBtn.addEventListener("click", () => {
            void (async () => {
                this.plugin.settings.searchShowDescendants = !this.plugin.settings.searchShowDescendants;
                showDescendantsBtn.toggleClass("is-active", this.plugin.settings.searchShowDescendants);
                await this.plugin.saveSettings();
                this.plugin.contextEngine.emit('changed', this.plugin.contextEngine.getState());
            })();
        });

        this.searchInput.addEventListener("input", () => {
            const query = this.searchInput.value;
            Logger.debug(`[Abstract Folder] View: Search input changed to "${query}"`);
            this.plugin.contextEngine.setFilter(query);
            // The ContextEngine will emit 'changed', triggering refreshTree()
        });

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

        // Subscribe to graph changes
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        this.registerEvent(this.app.workspace.on('abstract-folder:graph-updated' as any, () => {
            // 1. Snapshot physical paths BEFORE rebuilding the tree
            if (this.currentSnapshot?.locationMap) {
                this.plugin.contextEngine.snapshotPhysicalPaths(this.currentSnapshot.locationMap);
            }
            // 2. Refresh the tree (this generates a NEW locationMap)
            void this.refreshTree().then(() => {
                // 3. Repair the state based on the NEW locationMap
                if (this.currentSnapshot?.locationMap) {
                    this.plugin.contextEngine.repairState(this.currentSnapshot.locationMap);
                }
            });
        }));

        // Initial build
        await this.refreshTree();

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

    public focusSearch() {
        if (this.searchInput) {
            this.searchInput.focus();
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

        // 1. Update Search Input
        this.searchInput.value = activeFile.basename;
        
        // 2. Enable Ancestry Toggles
        this.plugin.settings.searchShowAncestors = true;
        this.plugin.settings.searchShowDescendants = true;
        
        if (this.showAncestorsBtn) this.showAncestorsBtn.addClass("is-active");
        if (this.showDescendantsBtn) this.showDescendantsBtn.addClass("is-active");

        // 3. Trigger Search & Save
        this.plugin.contextEngine.setFilter(activeFile.basename);
        await this.plugin.saveSettings();

        // Reveal in tree logic (V2 migration)
        const snapshot = this.currentSnapshot;
        if (snapshot) {
            const matchingNode = snapshot.items.find(item => item.id === activeFile.path);
            if (matchingNode) {
                const targetUri = matchingNode.uri;
                this.plugin.contextEngine.select(targetUri, { multi: false });
                this.viewport.scrollToItem(targetUri);
            }
        }
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
                return this.refreshTree();
            })
            .catch((error) => {
                console.error("Failed to move node", error);
                new Notice("Failed to move node. See console for details.");
            });
    }

    private async refreshTree() {
        if (this.isRefreshing) {
            this.nextRefreshScheduled = true;
            return;
        }
        this.isRefreshing = true;
        this.nextRefreshScheduled = false;

        try {
            const state = this.plugin.contextEngine.getState();
            // Use searchInput value directly if available for more immediate feedback
            const filterQuery = this.searchInput ? this.searchInput.value : state.activeFilter;
            
            // Refresh logic is now silent and robust.

            // If we have a filter, we FORCE expansion during build
            const generator = this.plugin.treeBuilder.buildTree(
                this.plugin.contextEngine,
                filterQuery,
                !!filterQuery // Force expand all if searching
            );
            while (true) {
                const result = await generator.next();
                if (result.done) {
                    this.currentSnapshot = result.value;
                    break;
                }
            }

            if (this.currentSnapshot) {
                this.viewport.setItems(this.currentSnapshot.items);
            }
            if (this.statusBar) {
                this.statusBar.refreshStatus();
            }
        } catch (error) {
            console.error("Failed to refresh tree", error);
        } finally {
            this.isRefreshing = false;
            if (this.nextRefreshScheduled) {
                this.nextRefreshScheduled = false;
                void this.refreshTree();
            }
        }
    }
}
