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

    public generateItems(): void {
        const activeGroup = this.settings.activeGroupId
            ? this.settings.groups.find(group => group.id === this.settings.activeGroupId)
            : undefined;

        const expandedSet = new Set(this.settings.expandedFolders);

        this.flatItems = generateFlatItemsFromGraph(
            this.app,
            this.indexer.getGraph(),
            expandedSet,
            (a, b) => this.sortNodes(a, b),
            activeGroup,
            this.viewState.excludeExtensions
        );

        if (this.virtualSpacer) {
            this.virtualSpacer.style.setProperty('height', `${this.flatItems.length * this.ITEM_HEIGHT}px`);
        }
    }

    public updateRender(): void {
        if (!this.virtualContainer || !this.containerEl) return;

        const scrollTop = this.containerEl.scrollTop;
        const clientHeight = this.containerEl.clientHeight || window.innerHeight;
        
        const headerEl = this.containerEl.querySelector(".abstract-folder-header-title") as HTMLElement;
        const headerHeight = headerEl ? headerEl.offsetHeight + (parseInt(getComputedStyle(headerEl).marginTop) || 0) + (parseInt(getComputedStyle(headerEl).marginBottom) || 0) : 0;

        const effectiveScrollTop = Math.max(0, scrollTop - headerHeight);
        
        const bufferItems = 5;
        const startIndex = Math.max(0, Math.floor(effectiveScrollTop / this.ITEM_HEIGHT) - bufferItems);
        const endIndex = Math.min(this.flatItems.length, Math.ceil((effectiveScrollTop + clientHeight) / this.ITEM_HEIGHT) + bufferItems);

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

        for (let i = startIndex; i < endIndex; i++) {
            if (!this.renderedItems.has(i)) {
                const item = this.flatItems[i];
                if (item) {
                    const tempContainer = document.createElement("div");
                    this.treeRenderer.renderFlatItem(item, tempContainer, i * this.ITEM_HEIGHT);
                    const el = tempContainer.firstElementChild as HTMLElement;
                    if (el) {
                        this.virtualContainer.appendChild(el);
                        this.renderedItems.set(i, el);
                    }
                }
            }
        }
    }
}
