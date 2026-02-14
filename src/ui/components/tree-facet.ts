import { BaseFacet } from "./base-facet";
import { VirtualViewport, ViewportDelegate, ViewportItem } from "./virtual-viewport";
import { Logger } from "../../utils/logger";
import { ContextMenuHandler } from "../context-menu";
import { App } from "obsidian";
import { TreeCoordinator } from "../../core/tree-coordinator";
import { ContextEngine } from "../../core/context-engine";
import AbstractFolderPlugin from "../../../main";

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
            void this.refresh();
        }));
        
        // Initial render
        void this.refresh();
    }

    private async refresh() {
        const items = await this.treeCoordinator.getFlatVisibleItems();
        this.viewport.setItems(items);
    }

    private renderNode(item: ViewportItem, container: HTMLElement) {
        const node = item.node;
        const el = container.createDiv({
            cls: "abstract-folder-item",
            attr: { "data-uri": node.uri.path }
        });

        el.addEventListener("click", (evt) => {
            evt.preventDefault();
            this.contextEngine.toggleExpansion(node.uri);
        });

        el.addEventListener("contextmenu", (evt) => {
            evt.preventDefault();
            const multiSelectedPaths = new Set<string>(); // Placeholder for now
            this.contextMenuHandler.showContextMenu(evt, node.metadata?.folderNode as any || { path: node.uri.path, file: this.app.vault.getAbstractFileByPath(node.uri.path) }, multiSelectedPaths);
        });

        // Basic indentation (simulated for now)
        el.createDiv({ cls: "abstract-folder-item-inner", text: node.name });
    }

    onDestroy(): void {
        if (this.viewport) {
            this.viewport.destroy();
        }
        super.onDestroy();
    }
}
