import { BaseFacet } from "./base-facet";
import { VirtualViewport, ViewportDelegate, ViewportItem } from "./virtual-viewport";
import { Logger } from "../../utils/logger";
import { ContextMenuHandler } from "../context-menu";
import { App, setIcon, TFile } from "obsidian";
import { TreeCoordinator } from "../../core/tree-coordinator";
import { ContextEngine } from "../../core/context-engine";
import AbstractFolderPlugin from "../../../main";
import { URIUtils } from "../../core/uri";

/**
 * TreeFacet manages the rendering of the tree structure using the VirtualViewport.
 */
export class TreeFacet extends BaseFacet {
    private viewport: VirtualViewport;
    private contextMenuHandler: ContextMenuHandler;

    constructor(
        treeCoordinator: TreeCoordinator,
        contextEngine: ContextEngine,
        containerEl: HTMLElement,
        private app: App,
        private plugin: AbstractFolderPlugin
    ) {
        super(treeCoordinator, contextEngine, containerEl);
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
            Logger.debug("TreeFacet: ContextEngine changed, refreshing.");
            void this.refresh();
        }));

        // Subscribe to graph updates from indexer
        // Note: Using 'any' cast for custom event name to satisfy Obsidian's EventRef type constraints
        const eventRef = (this.app.workspace as any).on('abstract-folder:graph-updated', () => {
            Logger.debug("TreeFacet: Graph updated event received.");
            Logger.debug("TreeFacet: Graph updated, refreshing view.");
            void this.refresh();
        });
        this.subscribe(() => (this.app.workspace as any).offref(eventRef));
        
        // Initial render
        void this.refresh();
    }

    private async refresh() {
        Logger.debug("TreeFacet: refresh() triggered.");
        const items = await this.treeCoordinator.getFlatVisibleItems();
        Logger.debug(`TreeFacet: refresh() received ${items.length} items from coordinator.`);
        this.viewport.setItems(items);
    }

    private renderNode(item: ViewportItem, container: HTMLElement) {
        const node = item.node;
        const depth = node.depth || 0;
        const serializedUri = URIUtils.toString(node.uri);
        const isExpanded = this.contextEngine.getState().expandedURIs.has(serializedUri) ||
                          this.contextEngine.getState().expandedURIs.has(node.uri.path);

        const el = container.createDiv({
            cls: `abstract-folder-item nav-file ${node.isFolder ? 'nav-folder' : ''}`,
            attr: { "data-uri": node.uri.path }
        });

        if (node.isFolder && !isExpanded) {
            el.addClass("is-collapsed");
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

        el.addEventListener("click", (evt) => {
            evt.preventDefault();
            const serialized = URIUtils.toString(node.uri);
            Logger.debug(`TreeFacet: Item clicked: ${node.uri.path} (full: ${serialized}), isFolder: ${node.isFolder}`);
            if (node.isFolder) {
                this.contextEngine.toggleExpansion(node.uri);
            } else {
                // Focus file
                const file = this.app.vault.getAbstractFileByPath(node.uri.path);
                if (file instanceof TFile) {
                    void this.app.workspace.getLeaf(false).openFile(file);
                }
            }
        });

        el.addEventListener("contextmenu", (evt) => {
            evt.preventDefault();
            const multiSelectedPaths = new Set<string>();
            this.contextMenuHandler.showContextMenu(evt, node.metadata?.folderNode as any || { path: node.uri.path, file: this.app.vault.getAbstractFileByPath(node.uri.path) }, multiSelectedPaths);
        });
    }

    onDestroy(): void {
        if (this.viewport) {
            this.viewport.destroy();
        }
        super.onDestroy();
    }
}
