import { ItemView, WorkspaceLeaf, setIcon, TFolder, TFile, Platform } from "obsidian";
import type AbstractFolderPlugin from "../../../main";
import { LibraryNode } from "../types";
import { Logger } from "../../utils/logger";
import { VirtualViewport, ViewportDelegate } from "../../ui/components/virtual-viewport";
import { ContextEngine } from "../../core/context-engine";
import { AbstractNode } from "../../core/tree-builder";

export const VIEW_TYPE_LIBRARY_EXPLORER = "abstract-library-explorer";

/**
 * LibraryExplorerView provides a dedicated interface for browsing installed libraries.
 * It features a "Shelf" view with pill-shaped selection and a scoped "Tree" view for the selected library.
 */
export class LibraryExplorerView extends ItemView implements ViewportDelegate {
    private viewport: VirtualViewport | null = null;
    private contextEngine: ContextEngine;
    private selectedLibrary: LibraryNode | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: AbstractFolderPlugin) {
        super(leaf);
        this.contextEngine = new ContextEngine(plugin.settings);
    }

    getViewType(): string {
        return VIEW_TYPE_LIBRARY_EXPLORER;
    }

    getDisplayText(): string {
        return "Library explorer";
    }

    getIcon(): string {
        return "library";
    }

    async onOpen() {
        // @ts-ignore - Internal workspace event
        this.registerEvent(this.app.workspace.on("abstract-folder:library-changed", () => {
            this.renderView();
        }));
        this.renderView();
    }

    private renderView() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("abstract-library-explorer");

        if (this.selectedLibrary) {
            void this.renderLibraryTree(container);
        } else {
            void this.renderShelf(container);
        }
    }

    private async renderShelf(container: HTMLElement) {
        container.createEl("h2", { text: "Libraries" });

        const shelfContainer = container.createDiv({ cls: "library-shelf" });
        const libraries = await this.plugin.abstractBridge.discoverLibraries(this.plugin.settings.librarySettings.librariesPath);

        if (libraries.length === 0) {
            shelfContainer.createEl("p", {
                text: "No libraries installed. Visit the library center to discover and install libraries.",
                cls: "empty-state"
            });
            const openCenterBtn = shelfContainer.createEl("button", { text: "Open library center" });
            openCenterBtn.addEventListener("click", () => {
                void this.plugin.activateLibraryCenter();
            });
            return;
        }

        const cardContainer = shelfContainer.createDiv({ cls: "library-card-container" });

        libraries.forEach(lib => {
            const card = cardContainer.createDiv({ cls: "library-explorer-card" });
            const iconContainer = card.createDiv({ cls: "library-card-icon" });
            setIcon(iconContainer, "folder-closed");
            
            const info = card.createDiv({ cls: "library-card-info" });
            if (lib.file instanceof TFolder) {
                info.createDiv({ cls: "library-card-name", text: lib.file.name });
            }
            
            card.addEventListener("click", () => {
                this.selectedLibrary = lib;
                this.renderView();
            });
        });
    }

    private async renderLibraryTree(container: HTMLElement) {
        if (!this.selectedLibrary) return;

        const header = container.createDiv({ cls: "library-tree-header" });
        
        const backBtn = header.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Back to shelf" } });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => {
            if (this.viewport) {
                this.viewport.destroy();
                this.viewport = null;
            }
            this.selectedLibrary = null;
            this.renderView();
        });

        if (this.selectedLibrary.file instanceof TFolder) {
            header.createEl("h3", { text: this.selectedLibrary.file.name });
        }

        const treeContainer = container.createDiv({ cls: "abstract-folder-tree-container" });
        const scrollContainer = treeContainer.createDiv({ cls: "abstract-folder-viewport-scroll" });
        const spacerEl = scrollContainer.createDiv({ cls: "abstract-folder-viewport-spacer" });
        const contentEl = scrollContainer.createDiv({ cls: "abstract-folder-viewport-content" });

        Logger.debug("LibraryExplorerView: Mounting Viewport for selected library.");

        this.viewport = new VirtualViewport(
            contentEl,
            scrollContainer,
            spacerEl,
            this.contextEngine,
            this.plugin.scopeProjector,
            this,
        );
        await this.refreshLibraryTree();
    }

    private async refreshLibraryTree() {
        if (!this.viewport || !this.selectedLibrary) return;

        const libraryFile = this.selectedLibrary.file;
        const libraryPath = libraryFile ? libraryFile.path : null;
        
        // Strategic Cache Ingestion:
        // Before building the tree, we seed the GraphEngine with relationships
        // discovered by the Bridge's manual scan. This ensures the V2 Pipeline
        // sees the correct hierarchy even if Obsidian's cache is stale.
        if (libraryPath) {
            const relationships = this.plugin.abstractBridge.getLibraryRelationships(libraryPath);
            if (relationships) {
                this.plugin.graphEngine.seedRelationships(relationships);
            }
        }

        // Use the library's root folder as the active group to establish hierarchy
        const generator = this.plugin.treeBuilder.buildTree(this.contextEngine, null, false, libraryPath);
        let result;
        while (true) {
            const next = await generator.next();
            if (next.done) {
                result = next.value;
                break;
            }
        }

        if (result) {
            this.viewport.setItems(result.items);
            this.viewport.update();
        }
    }

    // ViewportDelegateV2 implementation
    getItemHeight(): number {
        return 24;
    }

    isMobile(): boolean {
        return Platform.isMobile;
    }

    onItemClick(node: AbstractNode, event: MouseEvent): void {
        this.contextEngine.select(node.uri, { multi: event.ctrlKey || event.metaKey });
        const file = this.app.vault.getAbstractFileByPath(node.id);
        if (file instanceof TFile) {
            void this.app.workspace.getLeaf(false).openFile(file);
        }
    }

    onItemToggle(node: AbstractNode, event: MouseEvent): void {
        this.contextEngine.toggleExpand(node.uri);
        // Tree rebuild is handled by ContextEngine 'changed' listener in the future,
        // but for now, the LibraryExplorerView needs to manually rebuild the tree
        // because its tree structure depends on the expansion state which might
        // change the flat list length.
        void this.refreshLibraryTree();
    }

    onItemContextMenu(node: AbstractNode, event: MouseEvent): void {
        // Library nodes are often read-only, but we can still show standard actions
        // Extract items from current snapshot for selection mapping
        // This is simplified for LibraryExplorerView since it manages its own contextEngine
        const selection = this.contextEngine.getState().selectedURIs;
        
        // Items are not easily accessible here without storing the result of refreshLibraryTree
        // For now, let's just pass an empty array or the node itself
        this.plugin.contextMenuHandler.showV2ContextMenu(
            event,
            node,
            selection,
            [] // Simplified
        );
    }

    onItemDrop(draggedPath: string, targetNode: AbstractNode): void {
        // Library view might be read-only or have different D&D rules
    }

    async onClose() {
        if (this.viewport) {
            this.viewport.destroy();
            this.viewport = null;
        }
    }
}
