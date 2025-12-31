import { App, TFile } from "obsidian";
import { AbstractFolderPluginSettings } from "./settings";
import { ViewState } from "./ui/view-state";
import { ColumnRenderer } from "./ui/column/column-renderer";
import { FolderIndexer } from "./indexer";
import AbstractFolderPlugin from "../main";
import { VirtualTreeManager } from "./ui/view/virtual-tree-manager";
import { AncestryEngine } from "./utils/ancestry";

export class FileRevealManager {
    private app: App;
    private settings: AbstractFolderPluginSettings;
    private contentEl: HTMLElement;
    private viewState: ViewState;
    private indexer: FolderIndexer;
    private columnRenderer: ColumnRenderer;
    private renderView: () => void;
    private plugin: AbstractFolderPlugin;
    private virtualTreeManager: VirtualTreeManager;

    constructor(
        app: App,
        settings: AbstractFolderPluginSettings,
        contentEl: HTMLElement,
        viewState: ViewState,
        indexer: FolderIndexer,
        columnRenderer: ColumnRenderer,
        renderViewCallback: () => void,
        plugin: AbstractFolderPlugin,
        virtualTreeManager: VirtualTreeManager
    ) {
        this.app = app;
        this.settings = settings;
        this.contentEl = contentEl;
        this.viewState = viewState;
        this.indexer = indexer;
        this.columnRenderer = columnRenderer;
        this.renderView = renderViewCallback;
        this.plugin = plugin;
        this.virtualTreeManager = virtualTreeManager;
    }

    public onFileOpen = (file: TFile | null) => {
        if (!file) return;
        this.revealFile(file.path, this.settings.autoExpandParents);
    }

    public revealFile(filePath: string, expandParents: boolean = true) {
        if (this.settings.viewStyle === 'tree') {
            const expandedSet = new Set(this.settings.expandedFolders);
            let changed = false;

            if (expandParents && this.settings.autoExpandParents) {
                const ancestry = new AncestryEngine(this.indexer);
                const ancestors = ancestry.getAncestryNodePaths(filePath);
                ancestors.forEach(path => {
                    // Expand all ancestors, but not necessarily the file itself unless it's a folder we want to open
                    if (path !== filePath && !expandedSet.has(path)) {
                        expandedSet.add(path);
                        changed = true;
                    }
                });
            }

            if (this.settings.autoExpandChildren) {
                const graph = this.indexer.getGraph();
                // Check if the file acts as a parent (has children)
                if (graph.parentToChildren[filePath] && graph.parentToChildren[filePath].size > 0) {
                    if (!expandedSet.has(filePath)) {
                        expandedSet.add(filePath);
                        changed = true;
                    }
                }
            }

            if (changed) {
                this.settings.expandedFolders = Array.from(expandedSet);
                if (this.settings.rememberExpanded) {
                    this.plugin.saveSettings().catch(console.error);
                }
                this.renderView();
            } else {
                // Optimization: Just update highlight without full re-render/re-calculation of flat items
                this.virtualTreeManager.updateActiveFileHighlight();
            }

            // Scroll to the item in the virtual list
            if (this.settings.autoScrollToActiveFile) {
                requestAnimationFrame(() => {
                    const items = this.virtualTreeManager.getFlatItems();
                    const index = items.findIndex(item => item.node.path === filePath);
                    
                    if (index !== -1) {
                        const scrollContainer = this.contentEl.querySelector('.abstract-folder-virtual-wrapper');
                        if (scrollContainer) {
                            const itemHeight = 24; // Fixed height from VirtualTreeManager
                            const top = index * itemHeight;
                            
                            const containerHeight = scrollContainer.clientHeight;
                            const scrollTop = scrollContainer.scrollTop;
                            
                            // Scroll "nearest" behavior
                            if (top < scrollTop) {
                                scrollContainer.scrollTo({ top: top, behavior: 'smooth' });
                            } else if (top + itemHeight > scrollTop + containerHeight) {
                                scrollContainer.scrollTo({ top: top - containerHeight + itemHeight, behavior: 'smooth' });
                            }
                        }
                    }
                });
            }

        } else if (this.settings.viewStyle === 'column') {
            const isPathAlreadySelected = this.viewState.selectionPath.includes(filePath);

            if (!isPathAlreadySelected) {
                const pathSegments = this.indexer.getPathToRoot(filePath);
                this.viewState.selectionPath = pathSegments;
            }
            this.columnRenderer.setSelectionPath(this.viewState.selectionPath);
            this.renderView();
            setTimeout(() => {
                this.contentEl.querySelector(".abstract-folder-column:last-child")?.scrollIntoView({ block: "end", behavior: "smooth" });
            }, 0);
        }
    }
}
