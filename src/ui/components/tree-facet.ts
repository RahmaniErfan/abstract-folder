import { BaseFacet } from "./base-facet";
import { VirtualViewport, ViewportDelegate, ViewportItem } from "./virtual-viewport";

/**
 * TreeFacet manages the rendering of the tree structure using the VirtualViewport.
 */
export class TreeFacet extends BaseFacet {
    private viewport: VirtualViewport;
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
        this.subscribe(this.contextEngine.subscribe(() => this.refresh()));
        
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

        // Basic indentation
        // In a real implementation, we'd calculate depth in TreeCoordinator
        // and pass it via TreeNode or a wrapper
        el.createDiv({ cls: "abstract-folder-item-inner", text: node.name });
    }

    onDestroy(): void {
        if (this.viewport) {
            this.viewport.destroy();
        }
        super.onDestroy();
    }
}
