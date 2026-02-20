import { setIcon } from 'obsidian';
import { AbstractNode } from '../../core/tree-builder';
import { ContextEngine } from '../../core/context-engine';
import { ScopeProjector } from '../../core/scope-projector';
export interface ViewportDelegate {
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

export interface ViewportOptions {
    showGroupHeader?: boolean;
}

/**
 * VirtualViewport handles thepresentation layer of the file tree.
 * It uses absolute positioning for virtualized row rendering and indent guides.
 */
export class VirtualViewport {
    private items: AbstractNode[] = [];
    private renderedItems: Map<string, HTMLElement> = new Map();
    private resizeObserver: ResizeObserver;
    private HEADER_OFFSET = 24; 
    private groupHeaderEl: HTMLElement | null = null;
    private contextListener: () => void;
    private selectionListener: () => void;
    private options: ViewportOptions;
    
    constructor(
        private containerEl: HTMLElement,
        private scrollContainer: HTMLElement,
        private spacerEl: HTMLElement,
        private context: ContextEngine,
        private scope: ScopeProjector,
        private delegate: ViewportDelegate,
        options: ViewportOptions = {}
    ) {
        this.options = { showGroupHeader: true, ...options };
        this.HEADER_OFFSET = this.options.showGroupHeader ? 24 : 0;
        
        if (this.options.showGroupHeader) {
            this.createHeaderOverlay();
        }
        this.resizeObserver = new ResizeObserver(() => this.update());
        this.resizeObserver.observe(this.scrollContainer);
        this.scrollContainer.addEventListener("scroll", () => this.update());

        // Setup Reactive Listeners
        this.contextListener = () => this.update();
        this.selectionListener = () => {
            // Update ScopeProjector before repainting
            if (this.scope) {
                const state = this.context.getState();
                this.scope.update(state.selectedURIs);
            }
            this.update();
        };

        this.context.on('changed', this.contextListener);
        this.context.on('selection-changed', this.selectionListener);
    }

    /**
     * Re-renders the viewport with a new flat list.
     */
    public setItems(items: AbstractNode[]) {
        this.items = items;
        const itemHeight = this.delegate.isMobile() ? 32 : this.delegate.getItemHeight();
        this.spacerEl.style.height = `${this.HEADER_OFFSET + (this.items.length * itemHeight)}px`;
        this.update();
    }

    /**
     * Scrolls the viewport to a specific item by URI.
     */
    public scrollToItem(uri: string) {
        const index = this.items.findIndex(item => item.id === uri);
        if (index === -1) return;

        const itemHeight = this.delegate.isMobile() ? 32 : this.delegate.getItemHeight();
        const scrollPos = this.HEADER_OFFSET + (index * itemHeight);
        this.scrollContainer.scrollTop = scrollPos;
        this.update();
    }

    /**
     * Performs the windowed rendering logic.
     */
    public update() {
        if (!this.scrollContainer || !this.containerEl) return;
        this.updateGroupHeader();

        const scrollTop = this.scrollContainer.scrollTop;
        const clientHeight = this.scrollContainer.clientHeight;
        const itemHeight = this.delegate.isMobile() ? 32 : this.delegate.getItemHeight();
        
        const buffer = 25;
        const adjustedScrollTop = Math.max(0, scrollTop - this.HEADER_OFFSET);
        const startIndex = Math.max(0, Math.floor(adjustedScrollTop / itemHeight) - buffer);
        const endIndex = Math.min(this.items.length, Math.ceil((adjustedScrollTop + clientHeight) / itemHeight) + buffer);

        const visibleURIs = new Set<string>();

        // Render visible items
        for (let i = startIndex; i < endIndex; i++) {
            const node = this.items[i];
            visibleURIs.add(node.uri);

            let el = this.renderedItems.get(node.uri);
            if (!el) {
                el = this.createRow(node);
                this.containerEl.appendChild(el);
                this.renderedItems.set(node.uri, el);
            }

            // Update state-based classes and position
            this.updateRowState(el, node, i, itemHeight);
        }

        // Cleanup out-of-bounds items
        this.renderedItems.forEach((el, uri) => {
            if (!visibleURIs.has(uri)) {
                el.remove();
                this.renderedItems.delete(uri);
            }
        });
    }

    private createRow(node: AbstractNode): HTMLElement {
        const row = document.createElement("div");
        row.className = "af-item";
        
        const self = row.createDiv("af-item-self is-clickable");
        
        // 1. Disclosure Arrow Container
        self.createDiv("af-item-icon af-collapse-icon");

        // 2. Custom Icon Container
        self.createDiv("af-item-icon af-type-icon");

        // 3. Label Container
        self.createDiv("af-item-inner");

        // 4. Tag Container
        self.createDiv("nav-file-tag").style.display = "none";

        // Events
        row.addEventListener("click", (e) => this.delegate.onItemClick(node, e));
        row.addEventListener("contextmenu", (e) => this.delegate.onItemContextMenu(node, e));

        // Drag and Drop
        row.draggable = true;
        row.addEventListener("dragstart", (e) => {
            if (e.dataTransfer) {
                e.dataTransfer.setData("text/plain", node.id); 
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

    private updateRowContent(el: HTMLElement, node: AbstractNode) {
        // Performance Fingerprint: Skip expensive DOM/SVG logic if state hasn't changed.
        const settings = this.context.settings;
        const fingerprint = `${node.uri}:${node.name}:${node.syncStatus}:${node.icon}:${node.hasChildren}:${node.level}:${settings.enableRainbowIndents}:${settings.rainbowPalette}:${settings.enablePerItemRainbowColors}:${settings.showFileIcon}:${settings.showFolderIcon}`;
        if (el.dataset.fingerprint === fingerprint) return;
        el.dataset.fingerprint = fingerprint;

        const self = el.querySelector(".af-item-self") as HTMLElement;
        if (!self) return;

        let basename = node.name;
        let extension = "";
        const lastDotIndex = node.name.lastIndexOf('.');
        if (lastDotIndex > 0) {
            basename = node.name.substring(0, lastDotIndex);
            extension = node.name.substring(lastDotIndex + 1);
        }

        // 1. Disclosure Arrow (Chevron)
        const arrow = self.querySelector(".af-collapse-icon") as HTMLElement;
        if (arrow) {
            arrow.classList.remove("abstract-folder-hidden");
            if (node.hasChildren) {
                // We check if it already has an svg child to avoid redundant setIcon calls
                if (arrow.children.length === 0) {
                    setIcon(arrow, "right-triangle");
                    arrow.onclick = (e) => {
                        e.stopPropagation();
                        this.delegate.onItemToggle(node, e);
                    };
                }
                arrow.style.removeProperty("display");
                arrow.style.visibility = 'visible';
            } else {
                arrow.style.visibility = 'hidden';
                arrow.style.setProperty("display", "none", "important");
                arrow.onclick = null;
            }
        }

        // 2. Icon
        const iconEl = self.querySelector(".af-type-icon") as HTMLElement;
        if (iconEl) {
            iconEl.empty();
            let hasIcon = false;
            if (node.icon) {
                setIcon(iconEl, node.icon);
                hasIcon = true;
            } else if (node.hasChildren) {
                if (settings.showFolderIcon) {
                    setIcon(iconEl, "folder");
                    hasIcon = true;
                }
            } else {
                
                if (settings.showFileIcon) {
                    setIcon(iconEl, "file-text");
                    hasIcon = true;
                }
            }
            if (!hasIcon) {
                iconEl.style.setProperty("display", "none", "important");
            } else {
                iconEl.style.removeProperty("display");
            }
            iconEl.classList.toggle("abstract-folder-hidden", !hasIcon);
        }

        // 3. Label
        const inner = self.querySelector(".af-item-inner") as HTMLElement;
        if (inner) {
            let label = inner.querySelector(".af-item-label") as HTMLElement;
            if (!label) {
                label = inner.createSpan("af-item-label");
            }
            label.textContent = basename;
        }

        // 3.5 Extension Tag
        const tagEl = self.querySelector(".nav-file-tag") as HTMLElement;
        const tagExtension = extension.toLowerCase() === "md" ? "" : extension;
        if (tagEl) {
            if (tagExtension) {
                tagEl.textContent = tagExtension;
                tagEl.style.display = ""; // default display block
            } else {
                tagEl.style.display = "none";
            }
        }

        // 3.7 Indent Guides
        const enableRainbow = this.context.settings.enableRainbowIndents;
        const palette = this.context.settings.rainbowPalette;
        const perItemColors = this.context.settings.enablePerItemRainbowColors;

        const existingGuides = el.querySelectorAll('.abstract-folder-indent-guide');
        if (existingGuides.length !== node.level) {
            existingGuides.forEach(g => g.remove());
            for (let d = 0; d < node.level; d++) {
                const guide = document.createElement('div');
                guide.className = 'abstract-folder-indent-guide';
                
                if (enableRainbow) {
                    guide.classList.add(palette + '-palette');
                    // Index colors based on depth
                    const colorIndex = d % 10;
                    guide.classList.add(`rainbow-indent-${colorIndex}`);
                }
                
                guide.style.left = `${d * 18 + 13}px`;
                el.appendChild(guide);
            }
        }

        // 4. Sync status indicator (Direct child of self for absolute right alignment)
        let indicator = self.querySelector(".af-sync-indicator") as HTMLElement;
        if (node.syncStatus) {
            el.classList.remove("is-synced", "is-modified", "is-conflict", "is-untracked");
            el.classList.add(`is-${node.syncStatus}`);
            
            if (!indicator) {
                indicator = self.createDiv("af-sync-indicator");
            }
            indicator.className = `af-sync-indicator is-${node.syncStatus}`;
            
            const tooltips: any = {
                synced: "Synced with GitHub",
                modified: "Modified (Uncommitted)",
                conflict: "Merge Conflict!",
                untracked: "New file (Untracked)"
            };
            indicator.setAttribute("aria-label", tooltips[node.syncStatus] || "");
        } else if (indicator) {
            indicator.remove();
            el.classList.remove("is-synced", "is-modified", "is-conflict", "is-untracked");
        }
    }

    private updateRowState(el: HTMLElement, node: AbstractNode, index: number, itemHeight: number) {
        // Sync dynamic content (Label, Icon, Arrow, Guides) first
        this.updateRowContent(el, node);

        const isSelected = this.context.isSelected(node.uri);
        const isExpanded = this.context.isExpanded(node.uri);
        const isInScope = this.scope.isInScope(node.uri);

        const stateFingerprint = `${isSelected}:${isExpanded}:${isInScope}:${index}`;
        if (el.dataset.stateFingerprint === stateFingerprint) return;
        el.dataset.stateFingerprint = stateFingerprint;

        /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
        (el.style as any).position = 'absolute';
        (el.style as any).top = `${this.HEADER_OFFSET + (index * itemHeight)}px`;
        (el.style as any).width = '100%';
        (el.style as any).left = '0';
        /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
        
        // Indentation via CSS variable for guide logic
        el.style.setProperty('--depth', node.level.toString());

        // State classes
        el.classList.toggle("is-selected", isSelected);
        el.classList.toggle("is-expanded", isExpanded);
        el.classList.toggle("is-in-scope", isInScope);

        const arrow = el.querySelector(".af-collapse-icon");
        if (arrow && arrow instanceof HTMLElement) {
            // is-collapsed state: chevron points right (0deg rotation)
            // !is-collapsed state: chevron points down (rotated 90deg)
            arrow.classList.toggle("is-collapsed", !isExpanded);
            arrow.style.setProperty('visibility', node.hasChildren ? 'visible' : 'hidden');
        }
    }

    private createHeaderOverlay() {
        if (!this.options.showGroupHeader) return;
        this.groupHeaderEl = this.scrollContainer.createDiv("af-group-header");
        this.updateGroupHeader();
    }

    private updateGroupHeader() {
        if (!this.groupHeaderEl) return;
        
        const state = this.context.getState();
        const activeGroupId = state.activeGroupId;
        
        if (activeGroupId) {
            const group = this.context.settings.groups.find(g => g.id === activeGroupId);
            this.groupHeaderEl.textContent = group ? group.name : "Unknown group";
        } else {
            this.groupHeaderEl.textContent = "All files";
        }
    }

    public destroy() {
        this.context.off('changed', this.contextListener);
        this.context.off('selection-changed', this.selectionListener);
        this.resizeObserver.disconnect();
        this.renderedItems.clear();
        this.containerEl.empty();
    }

    /**
     * Surgical DOM Repainting Optimization:
     * Directly updates the content (e.g., Git sync status icons) of currently rendered rows
     * without triggering a full virtual list reconciliation.
     * Guarantees 100% accuracy based on the latest data model and prevents race conditions.
     */
    public forceUpdateVisibleRows() {
        // Iterate only over the DOM elements that are currently on screen
        this.renderedItems.forEach((el, uri) => {
            // Find the active data node for this URI
            const node = this.items.find(n => n.uri === uri);
            if (node) {
                // Clear the fingerprint so the updateRowContent method doesn't skip it
                el.dataset.fingerprint = "";
                // Surgically repaint just this row's content
                this.updateRowContent(el, node);
            }
        });
    }
}
