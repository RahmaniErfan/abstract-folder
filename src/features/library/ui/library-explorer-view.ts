import { ItemView, WorkspaceLeaf, debounce, TFolder, TFile } from "obsidian";
import type AbstractFolderPlugin from "../../../../main";
import { Logger } from "../../../utils/logger";
import { ContextEngine } from "../../../core/context-engine";
import { CatalogService } from "../services/catalog-service";
import { CatalogItem, LibraryNode } from "../types";
import { LibraryShelf } from "./components/library-shelf";
import { LibraryTopicScreen } from "./components/library-topic-screen";
import { LibraryDiscoveryDetail } from "./components/library-discovery-detail";
import { LibraryTreeView } from "./components/library-tree-view";

export const VIEW_TYPE_LIBRARY_EXPLORER = "abstract-library-explorer";

/**
 * LibraryExplorerView provides a dedicated interface for browsing installed libraries.
 * Refactored to use modular components for shelf, topic selection, tree view, and detail states.
 */
export class LibraryExplorerView extends ItemView {
    private contextEngine: ContextEngine;
    private catalogService: CatalogService;
    
    // UI State
    private selectedLibrary: LibraryNode | null = null;
    private selectedTopic: string | null = null;
    private selectedCatalogItem: CatalogItem | null = null;
    private searchQuery: string = "";
    private showAncestors = true;
    private showDescendants = true;

    // Components
    private shelf: LibraryShelf | null = null;
    private topicScreen: LibraryTopicScreen | null = null;
    private treeView: LibraryTreeView | null = null;
    private discoveryDetail: LibraryDiscoveryDetail | null = null;

    private isRenderingView = false;
    private renderViewPending = false;
    private debouncedRenderView: () => void;

    constructor(leaf: WorkspaceLeaf, private plugin: AbstractFolderPlugin) {
        super(leaf);
        this.contextEngine = new ContextEngine(plugin, 'library');
        this.catalogService = new CatalogService(this.plugin.settings.library);
        this.debouncedRenderView = debounce(this.renderView.bind(this), 300);
    }

    getViewType(): string {
        return VIEW_TYPE_LIBRARY_EXPLORER;
    }

    getDisplayText(): string {
        return "Library Catalog";
    }

    getIcon(): string {
        return "library";
    }

    async onOpen() {
        // @ts-ignore - Internal workspace event
        this.registerEvent(this.app.workspace.on("abstract-folder:library-changed", () => {
            this.renderView();
        }));

        // @ts-ignore
        this.registerEvent(this.app.workspace.on("abstract-folder:group-changed", () => {
            this.renderView();
        }));

        // @ts-ignore
        this.registerEvent(this.app.workspace.on("abstract-folder:git-refreshed", async (vaultPath?: string) => {
            // Surgical DOM Repainting via tree view component if active
            if (this.treeView && this.selectedLibrary && this.selectedLibrary.file && vaultPath) {
                const repoPath = this.selectedLibrary.file.path;
                if (vaultPath.startsWith(repoPath) || repoPath.startsWith(vaultPath)) {
                    const matrix = await this.plugin.libraryManager.getFileStatuses(repoPath);
                    const currentItems = this.treeView.getCurrentItems();
                    
                    for (const node of currentItems) {
                        const relativePath = (repoPath !== "" && node.id.startsWith(repoPath)) ? 
                            (node.id === repoPath ? "" : node.id.substring(repoPath.length + 1)) : node.id;
                        const status = matrix.get(relativePath);
                        node.syncStatus = status || undefined;
                    }
                    
                    this.treeView.forceUpdateVisibleRows();
                }
            }
        }));
        
        // @ts-ignore
        this.registerEvent(this.app.workspace.on("abstract-folder:spaces-updated", () => {
            this.debouncedRenderView();
        }));

        // @ts-ignore
        this.registerEvent(this.app.workspace.on("abstract-folder:graph-updated", () => {
             this.debouncedRenderView();
        }));

        this.registerContextListeners();

        this.registerEvent(this.app.workspace.on('file-open', () => this.syncWithActiveFile()));
        this.syncWithActiveFile();

        this.renderView();
    }

    private registerContextListeners() {
        this.contextEngine.removeAllListeners('changed');
        this.contextEngine.removeAllListeners('expand-all');

        this.contextEngine.on('changed', () => {
            if (this.treeView) {
                void this.treeView.refreshLibraryTree();
            } else {
                this.debouncedRenderView();
            }
        });

        this.contextEngine.on('expand-all', () => {
            if (this.treeView) {
                void this.treeView.refreshLibraryTree({ forceExpand: true });
            }
        });
    }

    private renderView() {
        if (this.isRenderingView) {
            this.renderViewPending = true;
            return;
        }
        this.isRenderingView = true;
        this.renderViewPending = false;

        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("abstract-library-explorer");

        const finish = () => { 
            this.isRenderingView = false; 
            if (this.renderViewPending) {
                this.renderViewPending = false;
                this.debouncedRenderView();
            }
        };

        if (this.selectedLibrary) {
            if (this.selectedTopic) {
                this.renderTreeView(container).then(finish).catch((e) => { Logger.error("renderView", e); finish(); });
            } else {
                this.renderTopicScreen(container).then(finish).catch((e) => { Logger.error("renderView", e); finish(); });
            }
        } else if (this.selectedCatalogItem) {
            this.renderDiscoveryDetail(container).then(finish).catch((e) => { Logger.error("renderView", e); finish(); });
        } else {
            this.renderShelf(container).then(finish).catch((e) => { Logger.error("renderView", e); finish(); });
        }
    }

    private async renderShelf(container: HTMLElement) {
        this.cleanupTreeView();
        this.shelf = new LibraryShelf(this.app, this.plugin, this.catalogService, {
            containerEl: container,
            searchQuery: this.searchQuery,
            onSearch: (q: string) => this.searchQuery = q,
            onLibrarySelect: (lib: LibraryNode) => {
                this.selectedLibrary = lib;
                this.contextEngine = new ContextEngine(this.plugin, `library:${lib.libraryId}`);
                this.registerContextListeners();
                this.searchQuery = "";
                this.renderView();
            },
            onCatalogItemSelect: (item: CatalogItem) => {
                this.selectedCatalogItem = item;
                this.searchQuery = "";
                this.renderView();
            }
        });
        await this.shelf.render();
    }

    private async renderTopicScreen(container: HTMLElement) {
        if (!this.selectedLibrary) return;
        this.cleanupTreeView();
        this.topicScreen = new LibraryTopicScreen(this.app, this.plugin, this.contextEngine, {
            containerEl: container,
            selectedLibrary: this.selectedLibrary,
            onBack: () => {
                this.selectedLibrary = null;
                this.selectedTopic = null;
                this.renderView();
            },
            onTopicSelect: (topic: string) => {
                this.selectedTopic = topic;
                this.contextEngine.setActiveTopic(topic);
                this.renderView();
            }
        });
        await this.topicScreen.render();
    }

    private async renderDiscoveryDetail(container: HTMLElement) {
        if (!this.selectedCatalogItem) return;
        this.cleanupTreeView();
        this.discoveryDetail = new LibraryDiscoveryDetail(this.app, this.plugin, this.catalogService, {
            containerEl: container,
            selectedCatalogItem: this.selectedCatalogItem,
            onBack: () => {
                this.selectedCatalogItem = null;
                this.renderView();
            },
            onInstallSuccess: async (destPath: string) => {
                this.selectedCatalogItem = null;
                const libs = await this.plugin.abstractBridge.discoverLibraries(this.plugin.settings.library.librariesPath, true);
                const matching = libs.find(l => l.path === destPath);
                if (matching) {
                    this.selectedLibrary = matching;
                    this.contextEngine = new ContextEngine(this.plugin, `library:${matching.libraryId}`);
                    this.registerContextListeners();
                }
                this.renderView();
            }
        });
        await this.discoveryDetail.render();
    }

    private async renderTreeView(container: HTMLElement) {
        if (!this.selectedLibrary) return;
        
        this.treeView = new LibraryTreeView(this.app, this.plugin, this.contextEngine, {
            containerEl: container,
            selectedLibrary: this.selectedLibrary,
            selectedTopic: this.selectedTopic,
            searchQuery: this.searchQuery,
            showAncestors: this.showAncestors,
            showDescendants: this.showDescendants,
            onBack: () => {
                if (this.selectedTopic) {
                    this.selectedTopic = null;
                    this.contextEngine.setActiveTopic(null);
                    this.renderView();
                } else {
                    this.cleanupTreeView();
                    this.selectedLibrary = null;
                    this.searchQuery = "";
                    this.renderView();
                }
            },
            onSearch: (q: string) => this.searchQuery = q,
            onSearchOptionsChange: (opts: { showAncestors?: boolean, showDescendants?: boolean }) => {
                if (opts.showAncestors !== undefined) this.showAncestors = opts.showAncestors;
                if (opts.showDescendants !== undefined) this.showDescendants = opts.showDescendants;
            }
        });
        await this.treeView.render();
    }

    private cleanupTreeView() {
        if (this.treeView) {
            this.treeView.destroy();
            this.treeView = null;
        }
    }

    syncWithActiveFile() {
        if (this.treeView) {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile && this.selectedLibrary && activeFile.path.startsWith(this.selectedLibrary.path)) {
                void this.treeView.refreshLibraryTree();
            }
        }
    }

    focusFile(path: string) {
        // Implementation for focusFile if needed
    }

    focusActiveFile() {
        if (this.treeView) {
            this.syncWithActiveFile();
        }
    }

    async onClose() {
        this.cleanupTreeView();
    }
}
