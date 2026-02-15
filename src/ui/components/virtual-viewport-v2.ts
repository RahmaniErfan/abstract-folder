import { setIcon } from 'obsidian';
import { AbstractNode } from '../../core/tree-builder';
import { ContextEngineV2 } from '../../core/context-engine-v2';
import { ScopeProjector } from '../../core/scope-projector';
import { Logger } from 'src/utils/logger';

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
        row.className = "af-v2-item";
        
        const self = row.createDiv("af-v2-item-self is-clickable");
        
        // Expansion Arrow (for folders)
        if (node.hasChildren) {
            const arrow = self.createDiv("af-v2-item-icon af-v2-collapse-icon");
            setIcon(arrow, "right-triangle");
            arrow.addEventListener("click", (e) => {
                e.stopPropagation();
                Logger.debug(`[Abstract Folder] Viewport: Toggle clicked for ${node.id}`);
                this.delegate.onItemToggle(node, e);
            });
        } else {
            self.createDiv("tree-item-icon"); // Spacer
        }

        // Label
        const label = self.createDiv("af-v2-item-inner");
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
        // Handle Indent Guides (Reddit style)
        const existingGuides = el.querySelectorAll('.af-v2-item-guide');
        const colors = [
            'var(--text-accent)',
            'var(--color-red)',
            'var(--color-orange)',
            'var(--color-yellow)',
            'var(--color-green)',
            'var(--color-cyan)',
            'var(--color-blue)',
            'var(--color-purple)',
            'var(--color-pink)'
        ];

        // Ensure correct number of guides
        if (existingGuides.length !== node.depth) {
            existingGuides.forEach(g => g.remove());
            for (let d = 0; d < node.depth; d++) {
                const guide = document.createElement('div');
                guide.className = 'af-v2-item-guide';
                guide.style.left = `${24 + d * 18}px`; // Match padding math (24 base + d * 18)
                guide.style.backgroundColor = colors[d % colors.length];
                el.appendChild(guide);
            }
        }

        const isSelected = this.context.isSelected(node.id);
        const isExpanded = this.context.isExpanded(node.id);
        const isInScope = this.scope.isDescendant(node.id);

        Logger.debug(`[Abstract Folder] Viewport: Row state for ${node.name}`, {
            id: node.id,
            isExpanded,
            isSelected,
            depth: node.depth
        });

        /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
        (el.style as any).position = 'absolute';
        (el.style as any).top = `${index * itemHeight}px`;
        (el.style as any).width = '100%';
        (el.style as any).left = '0';
        /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
        
        // Indentation via CSS variable for guide logic
        el.style.setProperty('--depth', node.depth.toString());

        // State classes
        el.classList.toggle("is-selected", isSelected);
        el.classList.toggle("is-expanded", isExpanded);
        el.classList.toggle("is-in-scope", isInScope);

        const arrow = el.querySelector(".af-v2-item-icon");
        if (arrow && arrow instanceof HTMLElement) {
            arrow.classList.toggle("is-collapsed", !isExpanded);
            arrow.style.setProperty('visibility', node.hasChildren ? 'visible' : 'hidden');
        }
    }

    public destroy() {
        this.resizeObserver.disconnect();
        this.renderedItems.clear();
        this.containerEl.empty();
    }
}
