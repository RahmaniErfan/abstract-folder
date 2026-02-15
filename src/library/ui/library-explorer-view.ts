import { ItemView, WorkspaceLeaf, setIcon, TFolder, TFile, Platform } from "obsidian";
import type AbstractFolderPlugin from "../../../main";
import { LibraryNode } from "../types";
import { Logger } from "../../utils/logger";
import { VirtualViewportV2, ViewportDelegateV2 } from "../../ui/components/virtual-viewport-v2";
import { ContextEngineV2 } from "../../core/context-engine-v2";
import { AbstractNode } from "../../core/tree-builder";

export const VIEW_TYPE_LIBRARY_EXPLORER = "abstract-library-explorer";

/**
 * LibraryExplorerView provides a dedicated interface for browsing installed libraries.
 * It features a "Shelf" view with pill-shaped selection and a scoped "Tree" view for the selected library.
 */
export class LibraryExplorerView extends ItemView implements ViewportDelegateV2 {
    private viewport: VirtualViewportV2 | null = null;
    private contextEngine: ContextEngineV2;
    private selectedLibrary: LibraryNode | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: AbstractFolderPlugin) {
        super(leaf);
        this.contextEngine = new ContextEngineV2();
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

        Logger.debug("LibraryExplorerView: Mounting V2 Viewport for selected library.");

        this.viewport = new VirtualViewportV2(
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
        if (!this.viewport) return;

        // For now, we use the global tree builder but we need to filter for the library.
        // TODO: Implement proper library scoping in TreeBuilder.
        const generator = this.plugin.treeBuilder.buildTree(this.contextEngine);
        let result;
        while (true) {
            const next = await generator.next();
            if (next.done) {
                result = next.value;
                break;
            }
        }

        if (result) {
            // Temporarily filter by path to simulate library scoping
            const libraryFile = this.selectedLibrary ? this.selectedLibrary.file : null;
            const libraryPath = libraryFile ? libraryFile.path : null;
            const filteredList = libraryPath
                ? result.flatList.filter(node => node.path.startsWith(libraryPath))
                : result.flatList;

            this.viewport.setItems(filteredList);
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
        this.contextEngine.select(node.id, { multi: event.ctrlKey || event.metaKey });
        const file = this.app.vault.getAbstractFileByPath(node.path);
        if (file instanceof TFile) {
            void this.app.workspace.getLeaf(false).openFile(file);
        }
    }

    onItemToggle(node: AbstractNode, event: MouseEvent): void {
        this.contextEngine.toggleExpand(node.id);
        void this.refreshLibraryTree();
    }

    onItemContextMenu(node: AbstractNode, event: MouseEvent): void {
        // Placeholder for library-specific context menu
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
