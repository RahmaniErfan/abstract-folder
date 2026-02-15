import { AbstractNode } from '../../core/tree-builder';
import { ContextEngineV2 } from '../../core/context-engine-v2';
import { ScopeProjector } from '../../core/scope-projector';

export interface ViewportDelegateV2 {
    /** Item height in pixels (default 24-28) */
    getItemHeight(): number;
    /** Returns the platform state */
    isMobile(): boolean;
    /** Notifies the delegate that an item was clicked */
    onItemClick(node: AbstractNode, event: MouseEvent): void;
    /** Notifies the delegate that an item was toggled (expanded/collapsed) */
    onItemToggle(node: AbstractNode, event: MouseEvent): void;
    /** Context menu trigger */
    onItemContextMenu(node: AbstractNode, event: MouseEvent): void;
    /** Drag and drop */
    onItemDrop(draggedPath: string, targetNode: AbstractNode): void;
}

/**
 * VirtualViewportV2 is the Presentation Layer for the v2 Architecture.
 * It uses absolute positioning and background-gradients for depth lines.
 */
export class VirtualViewportV2 {
    private items: AbstractNode[] = [];
    private renderedItems: Map<string, HTMLElement> = new Map();
    private resizeObserver: ResizeObserver;
    
    constructor(
        private containerEl: HTMLElement,
        private scrollContainer: HTMLElement,
        private spacerEl: HTMLElement,
        private context: ContextEngineV2,
        private scope: ScopeProjector,
        private delegate: ViewportDelegateV2
    ) {
        this.resizeObserver = new ResizeObserver(() => this.update());
        this.resizeObserver.observe(this.scrollContainer);
        this.scrollContainer.addEventListener("scroll", () => this.update());
    }

    /**
     * Re-renders the viewport with a new flat list.
     */
    public setItems(items: AbstractNode[]) {
        this.items = items;
        const itemHeight = this.delegate.isMobile() ? 32 : this.delegate.getItemHeight();
        this.spacerEl.style.height = `${this.items.length * itemHeight}px`;
        this.update();
    }

    /**
     * Performs the windowed rendering logic.
     */
    public update() {
        if (!this.scrollContainer || !this.containerEl) return;

        const scrollTop = this.scrollContainer.scrollTop;
        const clientHeight = this.scrollContainer.clientHeight;
        const itemHeight = this.delegate.isMobile() ? 32 : this.delegate.getItemHeight();
        
        const buffer = 5;
        const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
        const endIndex = Math.min(this.items.length, Math.ceil((scrollTop + clientHeight) / itemHeight) + buffer);

        const visibleIds = new Set<string>();

        // Render visible items
        for (let i = startIndex; i < endIndex; i++) {
            const node = this.items[i];
            visibleIds.add(node.id);

            let el = this.renderedItems.get(node.id);
            if (!el) {
                el = this.createRow(node);
                this.containerEl.appendChild(el);
                this.renderedItems.set(node.id, el);
            }

            // Update state-based classes and position
            this.updateRowState(el, node, i, itemHeight);
        }

        // Cleanup out-of-bounds items
        this.renderedItems.forEach((el, id) => {
            if (!visibleIds.has(id)) {
                el.remove();
                this.renderedItems.delete(id);
            }
        });
    }

    private createRow(node: AbstractNode): HTMLElement {
        const row = document.createElement("div");
        row.className = "tree-item nav-file";
        
        const self = row.createDiv("tree-item-self is-clickable nav-file-title");
        
        // Expansion Arrow (for folders)
        if (node.hasChildren) {
            const arrow = self.createDiv("tree-item-icon collapse-icon nav-folder-collapse-indicator");
            arrow.addEventListener("click", (e) => {
                e.stopPropagation();
                this.delegate.onItemToggle(node, e);
            });
        } else {
            self.createDiv("tree-item-icon"); // Spacer
        }

        // Icon
        const iconContainer = self.createDiv("tree-item-icon nav-file-tag");
        // TODO: Map extension to Obsidian icons
        iconContainer.innerText = node.extension === '' ? '📁' : '📄';

        // Label
        const label = self.createDiv("tree-item-inner nav-file-title-content");
        label.textContent = node.name;

        // Events
        // Events
        row.addEventListener("click", (e) => this.delegate.onItemClick(node, e));
        row.addEventListener("contextmenu", (e) => this.delegate.onItemContextMenu(node, e));

        // Drag and Drop
        row.draggable = true;
        row.addEventListener("dragstart", (e) => {
            if (e.dataTransfer) {
                e.dataTransfer.setData("text/plain", node.path);
                e.dataTransfer.effectAllowed = "move";
            }
        });

        row.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "move";
            }
            row.classList.add("abstract-folder-drag-over");
        });

        row.addEventListener("dragleave", () => {
            row.classList.remove("abstract-folder-drag-over");
        });

        row.addEventListener("drop", (e) => {
            e.preventDefault();
            row.classList.remove("abstract-folder-drag-over");
            if (e.dataTransfer) {
                const draggedPath = e.dataTransfer.getData("text/plain");
                this.delegate.onItemDrop(draggedPath, node);
            }
        });

        return row;
    }

    private updateRowState(el: HTMLElement, node: AbstractNode, index: number, itemHeight: number) {
        const isSelected = this.context.isSelected(node.id);
        const isExpanded = this.context.isExpanded(node.id);
        const isInScope = this.scope.isDescendant(node.id);

        el.style.position = 'absolute';
        el.style.top = `${index * itemHeight}px`;
        el.style.width = '100%';
        
        // Indentation
        el.style.setProperty('--depth', node.depth.toString());
        el.style.paddingLeft = `calc(${node.depth} * 18px)`;

        // State classes
        el.classList.toggle("is-selected", isSelected);
        el.classList.toggle("is-expanded", isExpanded);
        el.classList.toggle("is-in-scope", isInScope); // For v2 "Scoped Highlight"

        const arrow = el.querySelector(".collapse-icon");
        if (arrow) {
            arrow.classList.toggle("is-collapsed", !isExpanded);
        }
    }

    public destroy() {
        this.resizeObserver.disconnect();
        this.renderedItems.clear();
        this.containerEl.empty();
    }
}
