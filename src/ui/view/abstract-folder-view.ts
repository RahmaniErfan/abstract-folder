import { ItemView, WorkspaceLeaf, TFile, Notice, Platform, Menu } from "obsidian";
import type AbstractFolderPlugin from "main";
import { VirtualViewportV2, ViewportDelegateV2 } from "../components/virtual-viewport-v2";
import { TreeSnapshot, AbstractNode } from "../../core/tree-builder";
import { deleteAbstractFile, createAbstractChildFile, toggleHiddenStatus } from "../../utils/file-operations";

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

export class AbstractFolderView extends ItemView implements ViewportDelegateV2 {
    private plugin: AbstractFolderPlugin;
    private viewport: VirtualViewportV2;
    private searchInput: HTMLInputElement;
    private currentSnapshot: TreeSnapshot | null = null;
    private isRefreshing = false;

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
        
        toolbarEl.createEl("button", {
            cls: "clickable-icon",
            attr: { "aria-label": "Collapse all" }
        }, (el) => {
            el.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>';
            el.onclick = () => {
                this.plugin.contextEngineV2.collapseAll();
            };
        });

        toolbarEl.createEl("button", {
            cls: "clickable-icon",
            attr: { "aria-label": "Refresh tree" }
        }, (el) => {
            el.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>';
            el.onclick = async () => {
                await this.plugin.graphEngine.forceReindex();
                await this.refreshV2Tree();
            };
        });

        this.searchInput = headerEl.createEl("input", {
            type: "text",
            placeholder: "Search notes...",
            cls: "abstract-folder-search-input"
        });

        this.searchInput.addEventListener("input", () => {
            this.plugin.contextEngineV2.setFilter(this.searchInput.value);
        });

        // Viewport Container
        const scrollContainer = contentEl.createDiv({ cls: "abstract-folder-viewport-scroll-container" });
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

        // Subscribe to context changes
        this.plugin.contextEngineV2.on('changed', () => {
            void this.refreshV2Tree();
        });

        // Subscribe to graph changes
        this.registerEvent(this.app.workspace.on('abstract-folder:graph-updated' as any, () => {
            void this.refreshV2Tree();
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

    onItemClick(node: AbstractNode, event: MouseEvent): void {
        const file = this.app.vault.getAbstractFileByPath(node.path);
        if (file instanceof TFile) {
            this.app.workspace.getLeaf(event.ctrlKey || event.metaKey).openFile(file);
        }
    }

    onItemToggle(node: AbstractNode, event: MouseEvent): void {
        this.plugin.contextEngineV2.toggleExpand(node.id);
        void this.refreshV2Tree();
    }

    onItemContextMenu(node: AbstractNode, event: MouseEvent): void {
        const menu = new Menu();
        const file = this.app.vault.getAbstractFileByPath(node.path);

        if (file instanceof TFile) {
            menu.addItem((item) =>
                item
                    .setTitle("Open in new tab")
                    .setIcon("file-plus")
                    .onClick(() => {
                        this.app.workspace.getLeaf(true).openFile(file);
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

        this.plugin.transactionManager.moveNode(draggedFile, targetNode.path)
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
        if (this.isRefreshing) return;
        this.isRefreshing = true;

        try {
            const state = this.plugin.contextEngineV2.getState();
            const generator = this.plugin.treeBuilder.buildTree(this.plugin.contextEngineV2, state.activeFilter);
            while (true) {
                const result = await generator.next();
                if (result.done) {
                    this.currentSnapshot = result.value;
                    break;
                }
            }

            if (this.currentSnapshot) {
                this.viewport.setItems(this.currentSnapshot.flatList);
            }
        } catch (error) {
            console.error("Failed to refresh v2 tree", error);
        } finally {
            this.isRefreshing = false;
        }
    }
}
