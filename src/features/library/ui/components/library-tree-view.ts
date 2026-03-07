import { App, setIcon, TFolder, TFile } from "obsidian";
import type AbstractFolderPlugin from "../../../../../main";
import { Logger } from "../../../../utils/logger";
import { VirtualViewport, ViewportDelegate } from "../../../../core/ui/components/virtual-viewport";
import { ContextEngine } from "../../../../core/context-engine";
import { ScopedContentProvider } from "../../../../core/content-provider";
import { LibraryNode } from "../../types";
import { AbstractNode } from "../../../../core/tree-builder";

export interface LibraryTreeViewOptions {
    containerEl: HTMLElement;
    selectedLibrary: LibraryNode;
    selectedTopic: string | null;
    searchQuery: string;
    showAncestors: boolean;
    showDescendants: boolean;
    onBack: () => void;
    onSearch: (query: string) => void;
    onSearchOptionsChange: (options: { showAncestors?: boolean, showDescendants?: boolean }) => void;
}

export class LibraryTreeView implements ViewportDelegate {
    private viewport: VirtualViewport | null = null;
    private isRefreshing = false;
    private nextRefreshScheduled = false;
    private searchInput: HTMLInputElement;
    private clearSearchBtn: HTMLElement;
    private currentItems: AbstractNode[] = [];

    constructor(
        private app: App,
        private plugin: AbstractFolderPlugin,
        private contextEngine: ContextEngine,
        private options: LibraryTreeViewOptions
    ) {}

    async render() {
        const { containerEl } = this.options;
        containerEl.empty();

        const header = containerEl.createDiv({ cls: "abstract-folder-header" });
        await this.renderHeader(header);

        const treeContainer = containerEl.createDiv({ cls: "abstract-folder-tree-container" });
        const scrollContainer = treeContainer.createDiv({ cls: "abstract-folder-viewport-scroll-container nav-files-container" });
        const spacerEl = scrollContainer.createDiv({ cls: "abstract-folder-viewport-spacer" });
        const contentEl = scrollContainer.createDiv({ cls: "abstract-folder-viewport-rows" });

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
        const backBtn = titleRow.createDiv({ 
            cls: "af-header-back-button abstract-folder-toolbar-action clickable-icon", 
            attr: { "aria-label": "Back to shelf" } 
        });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => {
            this.options.onBack();
        });

        if (this.options.selectedLibrary && this.options.selectedLibrary.file instanceof TFolder) {
            const meta = this.plugin.graphEngine?.getNodeMeta?.(this.options.selectedLibrary.file.path);
            const iconToUse = meta?.icon || "library";
            
            const titleEl = titleRow.createEl("h3", { cls: "abstract-folder-header-title" });
            const iconEl = titleEl.createDiv({ cls: "af-header-icon" });
            
            if (this.options.selectedTopic) {
                setIcon(iconEl, this.options.selectedTopic === 'all' ? "layers" : "folder");
                titleEl.createSpan({ text: this.options.selectedTopic === 'all' ? "All Topics" : this.options.selectedTopic });
                titleEl.createSpan({ cls: "af-header-subtitle", text: ` in ${this.options.selectedLibrary.file.name}` });
            } else {
                setIcon(iconEl, iconToUse);
                titleEl.createSpan({ text: this.options.selectedLibrary.file.name });
            }
        }

        if (this.plugin.settings.visibility.libraries.showSearchHeader) {
            this.renderSearch(header, "Search in library...", () => {
                void this.refreshLibraryTree();
            }, true);
        }
    }

    private renderSearch(container: HTMLElement, placeholder: string, onSearch: () => void, includeOptions = false): HTMLElement {
        const searchContainer = container.createDiv({ cls: "abstract-folder-search-container" });
        const wrapper = searchContainer.createDiv({ cls: "abstract-folder-search-input-wrapper" });
        
        this.searchInput = wrapper.createEl("input", {
            type: "text",
            placeholder: placeholder,
            cls: "abstract-folder-search-input",
            value: this.options.searchQuery
        });

        this.clearSearchBtn = wrapper.createDiv({
            cls: "abstract-folder-search-clear",
            attr: { "aria-label": "Clear search" }
        });
        setIcon(this.clearSearchBtn, "x");
        this.updateClearButtonState();

        this.searchInput.addEventListener("input", () => {
            this.options.onSearch(this.searchInput.value);
            this.updateClearButtonState();
            onSearch();
        });

        this.clearSearchBtn.addEventListener("click", () => {
            this.options.onSearch("");
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
            if (this.options.showAncestors) showAncestorsBtn.addClass("is-active");

            showAncestorsBtn.addEventListener("click", () => {
                this.options.onSearchOptionsChange({ showAncestors: !this.options.showAncestors });
                showAncestorsBtn.toggleClass("is-active", !this.options.showAncestors);
                onSearch();
            });

            const showDescendantsBtn = searchContainer.createDiv({
                cls: "clickable-icon ancestry-search-toggle",
                attr: { "aria-label": "Show all descendants in search" }
            });
            setIcon(showDescendantsBtn, "arrow-down-right");
            if (this.options.showDescendants) showDescendantsBtn.addClass("is-active");

            showDescendantsBtn.addEventListener("click", () => {
                this.options.onSearchOptionsChange({ showDescendants: !this.options.showDescendants });
                showDescendantsBtn.toggleClass("is-active", !this.options.showDescendants);
                onSearch();
            });
        }

        return searchContainer;
    }

    private updateClearButtonState() {
        if (!this.clearSearchBtn) return;
        this.clearSearchBtn.toggleClass("is-active", this.options.searchQuery.length > 0);
    }

    async refreshLibraryTree(options: { forceExpand?: boolean } = {}) {
        if (!this.viewport || !this.options.selectedLibrary) return;
        
        if (this.isRefreshing) {
            this.nextRefreshScheduled = true;
            return;
        }
        this.isRefreshing = true;
        this.nextRefreshScheduled = false;

        try {
            const libraryFile = this.options.selectedLibrary.file;
            const libraryPath = libraryFile ? libraryFile.path : null;
            
            let effectiveScopingPath = libraryPath;
            if (this.options.selectedTopic && this.options.selectedTopic !== 'all' && libraryPath) {
                const requestedPath = `${libraryPath}/${this.options.selectedTopic}`;
                const abstractFile = this.app.vault.getAbstractFileByPath(requestedPath);
                if (!abstractFile) {
                    const libFolder = this.app.vault.getAbstractFileByPath(libraryPath);
                    if (libFolder instanceof TFolder) {
                        const match = libFolder.children.find(c => c.name.toLowerCase() === this.options.selectedTopic?.toLowerCase());
                        if (match) {
                            effectiveScopingPath = match.path;
                        } else {
                            effectiveScopingPath = requestedPath;
                        }
                    } else {
                        effectiveScopingPath = requestedPath;
                    }
                } else {
                    effectiveScopingPath = requestedPath;
                }
            }
            
            if (libraryPath) {
                const relationships = this.plugin.abstractBridge.getLibraryRelationships(libraryPath);
                if (relationships) {
                    this.plugin.graphEngine.seedRelationships(relationships);
                }
            }

            const state = this.contextEngine.getState();
            const provider = new ScopedContentProvider(
                this.app,
                this.plugin.settings,
                effectiveScopingPath || "",
                this.contextEngine.getScope(),
                true,
                state.activeGroupId
            );

            const generator = this.plugin.treeBuilder.buildTree(
                this.contextEngine,
                provider,
                {
                    filterQuery: this.options.searchQuery,
                    forceExpandAll: !!this.options.searchQuery || !!options.forceExpand,
                    showAncestors: this.options.showAncestors,
                    showDescendants: this.options.showDescendants
                }
            );

            let snapshot: any;
            while (true) {
                const result = await generator.next();
                if (result.done) {
                    snapshot = result.value;
                    break;
                }
            }

            if (snapshot) {
                this.currentItems = snapshot.items;
                this.viewport.setItems(snapshot.items);
            }
        } catch (error) {
            Logger.error("LibraryTreeView: Failed to refresh library tree", error);
        } finally {
            this.isRefreshing = false;
            if (this.nextRefreshScheduled) {
                this.nextRefreshScheduled = false;
                void this.refreshLibraryTree(options);
            }
        }
    }

    getItemHeight(): number {
        return 24;
    }

    isMobile(): boolean {
        // @ts-ignore
        return this.app.isMobile;
    }

    onItemClick(node: AbstractNode, event: MouseEvent): void {
        const file = this.app.vault.getAbstractFileByPath(node.id);
        if (file instanceof TFile) {
            this.app.workspace.getLeaf(event.ctrlKey || event.metaKey).openFile(file);
        }
    }

    onItemToggle(node: AbstractNode, event: MouseEvent): void {
        this.contextEngine.toggleExpand(node.uri);
    }

    onItemContextMenu(node: AbstractNode, event: MouseEvent): void {
    }

    onItemDrop(draggedPath: string, targetNode: AbstractNode): void {
    }

    validateDrop(draggedPath: string, targetNode: AbstractNode): boolean {
        return false;
    }

    getCurrentItems(): AbstractNode[] {
        return this.currentItems;
    }

    forceUpdateVisibleRows() {
        this.viewport?.forceUpdateVisibleRows();
    }

    destroy() {
        if (this.viewport) {
            this.viewport.destroy();
            this.viewport = null;
        }
    }
}
