import { App } from "obsidian";
import { FlatItem, generateFlatItemsFromGraph } from "../../utils/virtualization";
import { FolderIndexer } from "../../indexer";
import { AbstractFolderPluginSettings } from "../../settings";
import { ViewState } from "../view-state";
import { TreeRenderer } from "../tree/tree-renderer";
import { FolderNode } from "../../types";

export class VirtualTreeManager {
    private flatItems: FlatItem[] = [];
    private renderedItems: Map<number, HTMLElement> = new Map();
    private readonly ITEM_HEIGHT = 24;

    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private indexer: FolderIndexer,
        private viewState: ViewState,
        private treeRenderer: TreeRenderer,
        private containerEl: HTMLElement,
        private virtualSpacer: HTMLElement | null,
        private virtualContainer: HTMLElement | null,
        private sortNodes: (a: FolderNode, b: FolderNode) => number
    ) {}

    public getFlatItems(): FlatItem[] {
        return this.flatItems;
    }

    public clear(): void {
        this.renderedItems.clear();
        if (this.virtualContainer) this.virtualContainer.empty();
    }

    public generateItems(allowedPaths?: Set<string>, forceExpand?: Set<string>): void {
        const activeGroup = this.settings.activeGroupId
            ? this.settings.groups.find(group => group.id === this.settings.activeGroupId)
            : undefined;

        const expandedSet = new Set(this.settings.expandedFolders);
        if (forceExpand) {
            forceExpand.forEach(path => expandedSet.add(path));
        }

        this.flatItems = generateFlatItemsFromGraph(
            this.app,
            this.indexer.getGraph(),
            expandedSet,
            (a, b) => this.sortNodes(a, b),
            activeGroup,
            this.viewState.excludeExtensions
        );

        if (allowedPaths) {
            this.flatItems = this.flatItems.filter(item => allowedPaths.has(item.node.path));

            if (this.flatItems.length > 0) {
                const minDepth = Math.min(...this.flatItems.map(i => i.depth));
                if (minDepth > 0) {
                    this.flatItems.forEach(item => {
                        item.depth -= minDepth;
                    });
                }
            }
        }

        if (this.virtualSpacer) {
            this.virtualSpacer.style.setProperty('height', `${this.flatItems.length * this.ITEM_HEIGHT}px`);
        }
    }

    public updateActiveFileHighlight(): void {
        const activeFile = this.app.workspace.getActiveFile();
        const activePath = activeFile ? activeFile.path : null;

        this.renderedItems.forEach((el, index) => {
            const item = this.flatItems[index];
            if (!item || !el) return;

            const selfEl = el.querySelector('.abstract-folder-item-self');
            if (selfEl) {
                if (activePath && item.node.path === activePath) {
                    selfEl.addClass('is-active');
                } else {
                    selfEl.removeClass('is-active');
                }

                if (this.viewState.multiSelectedPaths.has(item.node.path)) {
                    selfEl.addClass('is-multi-selected');
                } else {
                    selfEl.removeClass('is-multi-selected');
                }
            }
        });
    }

    public updateRender(): void {
        if (!this.virtualContainer || !this.containerEl) return;

        // Use the virtual wrapper (scroll container) for calculations
        const scrollContainer = this.containerEl.querySelector('.abstract-folder-virtual-wrapper') as HTMLElement;
        if (!scrollContainer) return;

        const scrollTop = scrollContainer.scrollTop;
        const clientHeight = scrollContainer.clientHeight;
        
        const bufferItems = 5;
        const startIndex = Math.max(0, Math.floor(scrollTop / this.ITEM_HEIGHT) - bufferItems);
        const endIndex = Math.min(this.flatItems.length, Math.ceil((scrollTop + clientHeight) / this.ITEM_HEIGHT) + bufferItems);

        const keysToRemove: number[] = [];
        for (const index of this.renderedItems.keys()) {
            if (index < startIndex || index >= endIndex) {
                keysToRemove.push(index);
            }
        }

        for (const index of keysToRemove) {
            const el = this.renderedItems.get(index);
            if (el) el.remove();
            this.renderedItems.delete(index);
        }

        const activeFile = this.app.workspace.getActiveFile();
        const activePath = activeFile ? activeFile.path : null;

        for (let i = startIndex; i < endIndex; i++) {
            const item = this.flatItems[i];
            if (!item) continue;

            let el = this.renderedItems.get(i);

            // Check if the item at this index has changed (recycled index)
            if (el && el.dataset.path !== item.node.path) {
                el.remove();
                el = undefined;
                this.renderedItems.delete(i);
            }

            if (!el) {
                const tempContainer = document.createElement("div");
                this.treeRenderer.renderFlatItem(item, tempContainer, i * this.ITEM_HEIGHT);
                el = tempContainer.firstElementChild as HTMLElement;
                if (el) {
                    this.virtualContainer.appendChild(el);
                    this.renderedItems.set(i, el);
                }
            } else {
                // Update existing element state
                el.style.setProperty('top', `${i * this.ITEM_HEIGHT}px`);
                
                const selfEl = el.querySelector('.abstract-folder-item-self');
                if (selfEl) {
                    // Update Active State
                    if (activePath && item.node.path === activePath) {
                        selfEl.addClass('is-active');
                    } else {
                        selfEl.removeClass('is-active');
                    }

                    // Update Multi-select State
                    if (this.viewState.multiSelectedPaths.has(item.node.path)) {
                        selfEl.addClass('is-multi-selected');
                    } else {
                        selfEl.removeClass('is-multi-selected');
                    }
                }

                // Update Collapsed State
                if (item.node.isFolder) {
                    if (this.settings.expandedFolders.includes(item.node.path)) {
                        el.removeClass("is-collapsed");
                    } else {
                        el.addClass("is-collapsed");
                    }
                }
            }
        }
    }
}
