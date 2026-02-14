import { URIUtils } from "../../core/uri";
import { TreeNode } from "../../core/tree-provider";

export interface ViewportItem {
    node: TreeNode;
    index: number;
    top: number;
}

export interface ViewportDelegate {
    renderItem(item: ViewportItem, container: HTMLElement): void;
    onScroll?(scrollTop: number): void;
    getItemHeight(): number;
}

/**
 * VirtualViewport is a headless, high-performance virtualization engine.
 * It manages the windowing logic for large lists without being tied to specific UI logic.
 */
export class VirtualViewport {
    private items: TreeNode[] = [];
    private renderedItems: Map<string, HTMLElement> = new Map();
    private resizeObserver: ResizeObserver;
    
    constructor(
        private containerEl: HTMLElement,
        private scrollContainer: HTMLElement,
        private spacerEl: HTMLElement,
        private delegate: ViewportDelegate
    ) {
        this.resizeObserver = new ResizeObserver(() => this.update());
        this.resizeObserver.observe(this.scrollContainer);
        this.scrollContainer.addEventListener("scroll", () => this.update());
    }

    /**
     * Updates the data source and refreshes the view.
     */
    public setItems(items: TreeNode[]) {
        this.items = items;
        const itemHeight = this.delegate.getItemHeight();
        this.spacerEl.style.height = `${this.items.length * itemHeight}px`;
        this.update();
    }

    /**
     * The core windowing logic.
     */
    public update() {
        if (!this.scrollContainer || !this.containerEl) return;

        const scrollTop = this.scrollContainer.scrollTop;
        const clientHeight = this.scrollContainer.clientHeight;
        const itemHeight = this.delegate.getItemHeight();
        
        const buffer = 5;
        const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
        const endIndex = Math.min(this.items.length, Math.ceil((scrollTop + clientHeight) / itemHeight) + buffer);

        const visibleUris = new Set<string>();

        // Render visible items
        for (let i = startIndex; i < endIndex; i++) {
            const node = this.items[i];
            const uriString = URIUtils.toString(node.uri);
            visibleUris.add(uriString);

            let el = this.renderedItems.get(uriString);
            if (!el) {
                const temp = document.createElement("div");
                this.delegate.renderItem({ node, index: i, top: i * itemHeight }, temp);
                el = temp.firstElementChild as HTMLElement;
                if (el) {
                    this.containerEl.appendChild(el);
                    this.renderedItems.set(uriString, el);
                }
            }

            if (el) {
                el.style.position = 'absolute';
                el.style.top = `${i * itemHeight}px`;
                el.style.width = '100%';
            }
        }

        // Cleanup out-of-bounds items
        this.renderedItems.forEach((el, uri) => {
            if (!visibleUris.has(uri)) {
                el.remove();
                this.renderedItems.delete(uri);
            }
        });

        if (this.delegate.onScroll) {
            this.delegate.onScroll(scrollTop);
        }
    }

    public destroy() {
        this.resizeObserver.disconnect();
        this.scrollContainer.removeEventListener("scroll", () => this.update());
        this.renderedItems.clear();
        this.containerEl.empty();
    }
}
