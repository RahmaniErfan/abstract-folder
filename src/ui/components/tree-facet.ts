import { BaseFacet } from "./base-facet";
import { VirtualViewport, ViewportDelegate, ViewportItem } from "./virtual-viewport";
import { Logger } from "../../utils/logger";
import { ContextMenuHandler } from "../context-menu";
import { App, setIcon, TFile, TAbstractFile } from "obsidian";
import { TreeCoordinator } from "../../core/tree-coordinator";
import { ContextEngine } from "../../core/context-engine";
import AbstractFolderPlugin from "../../../main";
import { URIUtils } from "../../core/uri";
import { TreeNode, TreeContext } from "../../core/tree-provider";
import { DragManager } from "../dnd/drag-manager";
import { FolderNode } from "../../types";

/**
 * TreeFacet manages the rendering of the tree structure using the VirtualViewport.
 */
export class TreeFacet extends BaseFacet {
    private viewport: VirtualViewport;
    private contextMenuHandler: ContextMenuHandler;
    private dragManager: DragManager | null = null;
    private isActive = false;
    private refreshTimer: number | null = null;
    public treeContext: TreeContext = { providerIds: null, libraryId: null };

    constructor(
        treeCoordinator: TreeCoordinator,
        contextEngine: ContextEngine,
        containerEl: HTMLElement,
        private app: App,
        private plugin: AbstractFolderPlugin,
        treeContext?: Partial<TreeContext>
    ) {
        super(treeCoordinator, contextEngine, containerEl);
        if (treeContext) {
            this.treeContext = { ...this.treeContext, ...treeContext };
        }
        Logger.debug("TreeFacet: Initialized.");
        this.contextMenuHandler = new ContextMenuHandler(
            this.app,
            this.plugin.settings,
            this.plugin,
            this.plugin.indexer,
            (path: string) => {
                // TODO: Re-implement focus in SOVM
                Logger.debug("TreeFacet: Focus requested for", path);
            }
        );
    }

    private virtualWrapper: HTMLElement;
    private virtualSpacer: HTMLElement;
    private virtualContainer: HTMLElement;

    onMount(): void {
        this.isActive = true;
        Logger.debug("TreeFacet: onMount() called.");
        this.containerEl.addClass("abstract-folder-tree-facet");
        
        this.virtualWrapper = this.containerEl.createDiv({ cls: "abstract-folder-virtual-wrapper" });
        this.virtualSpacer = this.virtualWrapper.createDiv({ cls: "abstract-folder-virtual-spacer" });
        this.virtualContainer = this.virtualWrapper.createDiv({ cls: "abstract-folder-virtual-container" });

        const delegate: ViewportDelegate = {
            getItemHeight: () => 24, // Hardcoded for now, can be moved to settings
            renderItem: (item, container) => this.renderNode(item, container)
        };

        this.viewport = new VirtualViewport(
            this.virtualContainer,
            this.virtualWrapper,
            this.virtualSpacer,
            delegate
        );

        // Subscribe to engine changes
        this.subscribe(this.contextEngine.subscribe(() => {
            if (!this.isActive) return;
            Logger.debug("TreeFacet: ContextEngine changed, debouncing refresh.");
            this.debouncedRefresh();
        }));

        // Subscribe to graph updates from indexer
        // Note: Using 'any' cast for custom event name to satisfy Obsidian's EventRef type constraints
        const workspace = this.app.workspace as unknown as Record<string, (name: string, callback: () => void) => unknown>;
        const eventRef = workspace.on('abstract-folder:graph-updated', () => {
            if (!this.isActive) return;
            Logger.debug("TreeFacet: Graph updated event received.");
            this.debouncedRefresh();
        });
        this.subscribe(() => {
            const ws = this.app.workspace as unknown as Record<string, (ref: unknown) => void>;
            ws.offref(eventRef);
        });
        
        // Initial render
        void this.refresh();
    }

    private debouncedRefresh() {
        if (this.refreshTimer) {
            window.clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = window.setTimeout(() => {
            void this.refresh();
            this.refreshTimer = null;
        }, 50); // Small 50ms debounce to batch notifications
    }

    private async refresh() {
        Logger.debug("TreeFacet: refresh() triggered.");
        const items = await this.treeCoordinator.getFlatVisibleItems(this.treeContext);
        Logger.debug(`TreeFacet: refresh() received ${items.length} items from coordinator.`);
        this.viewport.setItems(items);
    }

    private renderNode(item: ViewportItem, container: HTMLElement) {
        const node = item.node;
        const depth = node.depth || 0;
        const state = this.contextEngine.getState();
        const serializedUri = URIUtils.toString(node.uri);
        const isExpanded = state.expandedURIs.has(serializedUri) ||
                          state.expandedURIs.has(node.uri.path);
        const isSelected = state.selectedURIs.has(serializedUri) || state.selectedURIs.has(node.uri.path);

        const el = container.createDiv({
            cls: `abstract-folder-item nav-file ${node.isFolder ? 'nav-folder' : ''}`,
            attr: { "data-uri": node.uri.path }
        });

        if (node.isFolder && !isExpanded) {
            el.addClass("is-collapsed");
        }

        if (isSelected) {
            el.addClass("is-selected");
        }

        const selfEl = el.createDiv({ cls: "nav-file-title abstract-folder-item-self" });
        selfEl.style.paddingLeft = `${depth * 20 + 8}px`;

        if (node.isFolder) {
            const collapseIcon = selfEl.createDiv({ cls: "nav-folder-collapse-indicator collapse-icon" });
            setIcon(collapseIcon, "right-triangle");
            if (!isExpanded) {
                collapseIcon.addClass("is-collapsed");
            }
        }

        // Icon Rendering (Support custom icons from metadata)
        const iconContainer = selfEl.createDiv({ cls: node.isFolder ? "nav-folder-icon" : "nav-file-icon" });
        let iconId = node.isFolder ? "folder" : "file-text";
        
        if (node.metadata && typeof node.metadata.icon === 'string') {
            iconId = node.metadata.icon;
        }

        setIcon(iconContainer, iconId);

        selfEl.createDiv({ cls: "nav-file-title-content", text: node.name });

        const file = this.app.vault.getAbstractFileByPath(node.uri.path);

        el.addEventListener("click", (evt) => {
            evt.preventDefault();
            const serialized = URIUtils.toString(node.uri);
            Logger.debug(`TreeFacet: Item clicked: ${node.uri.path} (full: ${serialized}), isFolder: ${node.isFolder}`);
            
            // Selection logic
            this.contextEngine.clearSelection();
            this.contextEngine.select(node.uri);

            if (node.isFolder) {
                this.contextEngine.toggleExpansion(node.uri);
            } else {
                // Focus file
                if (file instanceof TFile) {
                    void this.app.workspace.getLeaf(false).openFile(file);
                }
            }
        });

        el.addEventListener("contextmenu", (evt) => {
            evt.preventDefault();
            if (this.contextMenuHandler) {
                const multiSelectedPaths = new Set<string>();
                const folderNode = (node.metadata?.folderNode as FolderNode) || ({
                    path: node.uri.path,
                    isFolder: node.isFolder,
                    file: file,
                    isLibrary: node.uri.provider !== "local",
                    children: []
                } as FolderNode);
                this.contextMenuHandler.showContextMenu(evt, folderNode, multiSelectedPaths);
            }
        });

        this.setupDragEvents(el, node, file);
    }

    /**
     * Sets the drag manager for DnD support.
     */
    setDragManager(manager: DragManager) {
        this.dragManager = manager;
    }

    private setupDragEvents(el: HTMLElement, node: TreeNode, file: TAbstractFile | null) {
        if (this.dragManager) {
            el.draggable = true;
            el.addEventListener("dragstart", (e) => {
                const folderNode = (node.metadata?.folderNode as FolderNode) || ({
                    path: node.uri.path,
                    isFolder: node.isFolder,
                    file: file,
                    isLibrary: node.uri.provider !== "local",
                    children: []
                } as FolderNode);
                this.dragManager?.handleDragStart(e, folderNode, "", new Set());
            });

            el.addEventListener("dragover", (e) => {
                const folderNode = (node.metadata?.folderNode as FolderNode) || ({
                    path: node.uri.path,
                    isFolder: node.isFolder,
                    file: file,
                    isLibrary: node.uri.provider !== "local",
                    children: []
                } as FolderNode);
                this.dragManager?.handleDragOver(e, folderNode);
            });

            el.addEventListener("drop", (e) => {
                const folderNode = (node.metadata?.folderNode as FolderNode) || ({
                    path: node.uri.path,
                    isFolder: node.isFolder,
                    file: file,
                    isLibrary: node.uri.provider !== "local",
                    children: []
                } as FolderNode);
                
                if (this.dragManager && 'handleDrop' in this.dragManager) {
                    const manager = this.dragManager as unknown as Record<string, (e: DragEvent, node: FolderNode) => void>;
                    manager.handleDrop(e, folderNode);
                }
            });
        }
    }

    onDestroy(): void {
        this.isActive = false;
        if (this.refreshTimer) {
            window.clearTimeout(this.refreshTimer);
        }
        if (this.viewport) {
            this.viewport.destroy();
        }
        super.onDestroy();
    }
}
