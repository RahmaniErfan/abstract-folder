import { ItemView, WorkspaceLeaf, TFile, Notice, Platform, Menu, setIcon } from "obsidian";
import type AbstractFolderPlugin from "main";
import { VirtualViewportV2, ViewportDelegateV2 } from "../components/virtual-viewport-v2";
import { AbstractFolderViewToolbar } from "../toolbar/abstract-folder-view-toolbar";
import { TreeSnapshot, AbstractNode } from "../../core/tree-builder";
import { deleteAbstractFile, createAbstractChildFile, toggleHiddenStatus } from "../../utils/file-operations";
import { Logger } from "../../utils/logger";

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

export class AbstractFolderView extends ItemView implements ViewportDelegateV2 {
    private plugin: AbstractFolderPlugin;
    private viewport: VirtualViewportV2;
    private toolbar: AbstractFolderViewToolbar;
    private searchInput: HTMLInputElement;
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
        contentEl.addClass("abstract-folder-view-v2");

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
        setIcon(showAncestorsBtn, "arrow-up-left");
        if (this.plugin.settings.searchShowAncestors) showAncestorsBtn.addClass("is-active");

        showAncestorsBtn.addEventListener("click", () => {
            void (async () => {
                this.plugin.settings.searchShowAncestors = !this.plugin.settings.searchShowAncestors;
                showAncestorsBtn.toggleClass("is-active", this.plugin.settings.searchShowAncestors);
                await this.plugin.saveSettings();
                this.plugin.contextEngineV2.emit('changed', this.plugin.contextEngineV2.getState());
            })();
        });

        const showDescendantsBtn = searchContainer.createDiv({
            cls: "clickable-icon ancestry-search-toggle",
            attr: { "aria-label": "Show all descendants in search" }
        });
        setIcon(showDescendantsBtn, "arrow-down-right");
        if (this.plugin.settings.searchShowDescendants) showDescendantsBtn.addClass("is-active");

        showDescendantsBtn.addEventListener("click", () => {
            void (async () => {
                this.plugin.settings.searchShowDescendants = !this.plugin.settings.searchShowDescendants;
                showDescendantsBtn.toggleClass("is-active", this.plugin.settings.searchShowDescendants);
                await this.plugin.saveSettings();
                this.plugin.contextEngineV2.emit('changed', this.plugin.contextEngineV2.getState());
            })();
        });

        this.searchInput.addEventListener("input", () => {
            const query = this.searchInput.value;
            Logger.debug(`[Abstract Folder] View: Search input changed to "${query}"`);
            this.plugin.contextEngineV2.setFilter(query);
            // The ContextEngine will emit 'changed', triggering refreshV2Tree()
        });

        // Viewport Container
        const scrollContainer = contentEl.createDiv({ cls: "abstract-folder-viewport-scroll-container" });
        // Ensure standard Obsidian scroll behavior
        scrollContainer.addClass("nav-files-container");
        
        const spacerEl = scrollContainer.createDiv({ cls: "abstract-folder-viewport-spacer" });
        const rowsContainer = scrollContainer.createDiv({ cls: "abstract-folder-viewport-rows" });
        
        this.viewport = new VirtualViewportV2(
            rowsContainer,
            scrollContainer,
            spacerEl,
            this.plugin.contextEngineV2,
            this.plugin.scopeProjector,
            this
        );

        // Subscribe to selection changes to update ScopeProjector
        this.plugin.contextEngineV2.on('selection-changed', (selectedURIs: Set<string>) => {
            this.plugin.scopeProjector.update(selectedURIs);
            this.viewport.update(); // Fast repaint of visible rows
        });

        // Subscribe to general context changes
        this.plugin.contextEngineV2.on('changed', () => {
            void this.refreshV2Tree();
        });

        // Subscribe to graph changes
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        this.registerEvent(this.app.workspace.on('abstract-folder:graph-updated' as any, () => {
            // 1. Snapshot physical paths BEFORE rebuilding the tree
            if (this.currentSnapshot?.locationMap) {
                this.plugin.contextEngineV2.snapshotPhysicalPaths(this.currentSnapshot.locationMap);
            }
            // 2. Refresh the tree (this generates a NEW locationMap)
            void this.refreshV2Tree().then(() => {
                // 3. Repair the state based on the NEW locationMap
                if (this.currentSnapshot?.locationMap) {
                    this.plugin.contextEngineV2.repairState(this.currentSnapshot.locationMap);
                }
            });
        }));

        // Initial build
        await this.refreshV2Tree();
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

    public focusActiveFile() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        // Reveal in tree logic
        // Reveal in tree logic
        const snapshot = this.currentSnapshot;
        if (snapshot) {
            // In V2, locationMap is URI -> Index, but for "Reveal in Tree"
            // we need to find which URIs correspond to this physical FileID (activeFile.path).
            // This is a reverse lookup.
            const matchingNode = snapshot.items.find(item => item.id === activeFile.path);
            
            if (matchingNode) {
                const targetUri = matchingNode.uri;
                this.plugin.contextEngineV2.select(targetUri, { multi: false });
                
                // Ensure parents are expanded in the ContextEngine
                // URIs are constructed as root/child/grandchild
                const segments = targetUri.split('/');
                let cumulativeUri = '';
                for (let i = 0; i < segments.length - 1; i++) {
                    cumulativeUri += (i === 0 ? '' : '/') + segments[i];
                    if (!this.plugin.contextEngineV2.isExpanded(cumulativeUri)) {
                        this.plugin.contextEngineV2.toggleExpand(cumulativeUri);
                    }
                }
                
                void this.refreshV2Tree().then(() => {
                    this.viewport.scrollToItem(targetUri);
                });
            }
        }
    }

    onItemClick(node: AbstractNode, event: MouseEvent): void {
        const isMulti = event.ctrlKey || event.metaKey;
        const isRange = event.shiftKey;

        // 1. Update Selection State
        this.plugin.contextEngineV2.select(node.uri, {
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
        this.plugin.contextEngineV2.toggleExpand(node.uri);
        void this.refreshV2Tree();
    }

    onItemContextMenu(node: AbstractNode, event: MouseEvent): void {
        const menu = new Menu();
        const file = this.app.vault.getAbstractFileByPath(node.id);

        if (file instanceof TFile) {
            menu.addItem((item) =>
                item
                    .setTitle("Open in new tab")
                    .setIcon("file-plus")
                    .onClick(() => {
                        void this.app.workspace.getLeaf(true).openFile(file);
                    })
            );

            menu.addItem((item) =>
                item
                    .setTitle("Toggle hidden")
                    .setIcon("eye-off")
                    .onClick(async () => {
                        await toggleHiddenStatus(this.app, file, this.plugin.settings);
                    })
            );

            menu.addSeparator();

            menu.addItem((item) =>
                item
                    .setTitle("Create child note")
                    .setIcon("plus-circle")
                    .onClick(() => {
                        createAbstractChildFile(this.app, this.plugin.settings, "New Note", file, "note", this.plugin.graphEngine)
                            .catch(console.error);
                    })
            );

            menu.addSeparator();

            menu.addItem((item) =>
                item
                    .setTitle("Delete")
                    .setIcon("trash")
                    .onClick(async () => {
                        await deleteAbstractFile(this.app, file, false, this.plugin.graphEngine);
                    })
            );
        }

        menu.showAtMouseEvent(event);
    }

    onItemDrop(draggedPath: string, targetNode: AbstractNode): void {
        const draggedFile = this.app.vault.getAbstractFileByPath(draggedPath);
        if (!(draggedFile instanceof TFile)) return;

        this.plugin.transactionManager.moveNode(draggedFile, targetNode.id)
            .then(() => {
                new Notice(`Moved ${draggedFile.basename} to ${targetNode.name}`);
                return this.refreshV2Tree();
            })
            .catch((error) => {
                console.error("Failed to move node", error);
                new Notice("Failed to move node. See console for details.");
            });
    }

    private async refreshV2Tree() {
        if (this.isRefreshing) {
            this.nextRefreshScheduled = true;
            return;
        }
        this.isRefreshing = true;
        this.nextRefreshScheduled = false;

        try {
            const state = this.plugin.contextEngineV2.getState();
            // Use searchInput value directly if available for more immediate feedback
            const filterQuery = this.searchInput ? this.searchInput.value : state.activeFilter;
            
            // Refresh logic is now silent and robust.

            // If we have a filter, we FORCE expansion during build
            const generator = this.plugin.treeBuilder.buildTree(
                this.plugin.contextEngineV2,
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
        } catch (error) {
            console.error("Failed to refresh v2 tree", error);
        } finally {
            this.isRefreshing = false;
            if (this.nextRefreshScheduled) {
                this.nextRefreshScheduled = false;
                void this.refreshV2Tree();
            }
        }
    }
}
