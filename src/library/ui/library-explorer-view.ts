import { ItemView, WorkspaceLeaf, setIcon, TFile, TFolder } from "obsidian";
import type AbstractFolderPlugin from "../../../main";
import { TreeRenderer } from "../../ui/tree/tree-renderer";
import { VirtualTreeManager } from "../../ui/view/virtual-tree-manager";
import { ViewState } from "../../ui/view-state";
import { LibraryNode } from "../types";
import { Logger } from "../../utils/logger";

export const VIEW_TYPE_LIBRARY_EXPLORER = "abstract-library-explorer";

/**
 * LibraryExplorerView provides a dedicated interface for browsing installed libraries.
 * It features a "Shelf" view with pill-shaped selection and a scoped "Tree" view for the selected library.
 */
export class LibraryExplorerView extends ItemView {
    private virtualTreeManager: VirtualTreeManager;
    private viewState: ViewState;
    private treeRenderer: TreeRenderer;
    private selectedLibrary: LibraryNode | null = null;
    private searchInputEl: HTMLInputElement | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: AbstractFolderPlugin) {
        super(leaf);
        
        // Use a dedicated ViewState for the library explorer to avoid affecting the main view
        this.viewState = new ViewState(this.plugin.settings, this.plugin);
        
        this.treeRenderer = new TreeRenderer(
            this.app, this.plugin.settings, this.plugin,
            this.viewState.multiSelectedPaths,
            (node) => {
                if (node.file instanceof TFile) return node.file.basename;
                return node.path.split('/').pop() || "";
            },
            (itemEl, path, contextId) => this.toggleCollapse(itemEl, path, contextId),
            this.plugin.indexer,
            null as any,
            (path) => this.openFile(path)
        );
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
        // @ts-ignore - Custom workspace event
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

        const pillContainer = shelfContainer.createDiv({ cls: "library-pill-container" });

        libraries.forEach(lib => {
            const pill = pillContainer.createDiv({ cls: "library-pill" });
            const info = pill.createDiv({ cls: "library-pill-info" });
            if (lib.file instanceof TFolder) {
                info.createDiv({ cls: "library-pill-name", text: lib.file.name });
            }
            
            pill.addEventListener("click", () => {
                this.selectedLibrary = lib;
                this.renderView();
                void this.refreshLibraryTree();
            });
        });
    }

    private async renderLibraryTree(container: HTMLElement) {
        if (!this.selectedLibrary) return;

        const header = container.createDiv({ cls: "library-tree-header" });
        
        const backBtn = header.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Back to shelf" } });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => {
            this.selectedLibrary = null;
            this.renderView();
        });

        if (this.selectedLibrary.file instanceof TFolder) {
            header.createEl("h3", { text: this.selectedLibrary.file.name });
        }

        const refreshBtn = header.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Refresh library" } });
        setIcon(refreshBtn, "refresh-ccw");
        refreshBtn.addEventListener("click", () => {
            void (async () => {
                const libraries = await this.plugin.abstractBridge.discoverLibraries(this.plugin.settings.librarySettings.librariesPath);
                const updated = libraries.find(l => l.path === this.selectedLibrary?.path);
                if (updated) {
                    this.selectedLibrary = updated;
                    await this.refreshLibraryTree();
                }
            })();
        });

        const virtualWrapper = container.createDiv({ cls: "abstract-folder-virtual-wrapper" });
        const virtualSpacer = virtualWrapper.createDiv({ cls: "abstract-folder-virtual-spacer" });
        const virtualContainer = virtualWrapper.createDiv({ cls: "abstract-folder-virtual-container" });

        this.virtualTreeManager = new VirtualTreeManager(
            this.app, this.plugin.settings, null, this.viewState, this.treeRenderer,
            container, virtualSpacer, virtualContainer,
            (a, b) => a.path.localeCompare(b.path)
            // Note: We do NOT pass the bridge here because we use setSourceNodes()
            // for the library tree. Passing the bridge would trigger "Injected Library"
            // logic which is only for the main view.
        );

        await this.refreshLibraryTree();

        virtualWrapper.addEventListener("scroll", () => {
            this.virtualTreeManager.updateRender();
        });
    }

    private async refreshLibraryTree() {
        if (!this.selectedLibrary || !this.virtualTreeManager) return;
        
        // We use the children of the selected library as the source nodes
        // This avoids rendering the root "Library" folder itself inside its own tree
        this.virtualTreeManager.setSourceNodes(this.selectedLibrary.children);
        // We use "root" as the forced root context so that contextIds are generated
        // consistently (e.g., "root > path") matching how they would be in the main view.
        await this.virtualTreeManager.generateItems(undefined, undefined, false, "root");
        this.virtualTreeManager.updateRender();
    }

    private async toggleCollapse(itemEl: HTMLElement, path: string, contextId?: string) {
        const effectiveId = contextId || path;
        if (this.plugin.settings.expandedFolders.includes(effectiveId)) {
            this.plugin.settings.expandedFolders = this.plugin.settings.expandedFolders.filter(id => id !== effectiveId);
        } else {
            this.plugin.settings.expandedFolders.push(effectiveId);
        }
        await this.plugin.saveSettings();
        void this.refreshLibraryTree();
    }

    private openFile(path: string) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            this.app.workspace.getLeaf(false).openFile(file).catch(Logger.error);
        }
    }
}
