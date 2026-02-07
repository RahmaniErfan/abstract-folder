import { Logger } from "./utils/logger";
import { App, TFile } from "obsidian";
import { AbstractFolderPluginSettings } from "./settings";
import { ViewState } from "./ui/view-state";
import { ColumnRenderer } from "./ui/column/column-renderer";
import { FolderIndexer } from "./indexer";
import AbstractFolderPlugin from "../main";
import { VirtualTreeManager } from "./ui/view/virtual-tree-manager";
import { AncestryEngine } from "./utils/ancestry";
import { getContextualId } from "./utils/context-utils";

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
    private isInternalClick: boolean = false;

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

    public setInternalClick(value: boolean) {
        this.isInternalClick = value;
    }

    public revealFile(filePath: string, expandParents: boolean = true) {
        if (this.settings.viewStyle === 'tree') {
            const expandedSet = new Set(this.settings.expandedFolders);
            let changed = false;

            // Highlight the active file immediately
            this.virtualTreeManager.updateActiveFileHighlight();

            const preferredContextId = this.settings.lastInteractionContextId;

            // CRITICAL: If this is an internal click, we only wanted to update highlights.
            // However, we MUST still allow expansion if it hasn't happened yet.
            // We only skip the SCROLLING part for internal clicks.
            const shouldSkipScroll = this.isInternalClick;
            Logger.debug("FileRevealManager: revealFile", {
                filePath,
                preferredContextId,
                isInternalClick: this.isInternalClick,
                expandParents
            });

            if (this.isInternalClick) {
                this.isInternalClick = false;
            }

            if (expandParents && this.settings.autoExpandParents) {
                const ancestry = new AncestryEngine(this.indexer);
                const ancestryPaths = ancestry.getAllPaths(filePath);
                
                if (ancestryPaths.length > 0) {
                    // We need to expand ALL paths because the user wants all instances to be visible
                    for (const targetPath of ancestryPaths) {
                        let currentParent: string | null = null;
                        // The ancestry path is [root, ..., parent, file]
                        for (let i = 0; i < targetPath.segments.length - 1; i++) {
                            const currentPath = targetPath.segments[i];
                            const contextId = getContextualId(currentPath, currentParent);
                            
                            if (!expandedSet.has(contextId)) {
                                expandedSet.add(contextId);
                                changed = true;
                            }
                            currentParent = currentPath;
                        }
                    }
                }
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
                Logger.debug("FileRevealManager: expanded set updated", { count: expandedSet.size });
                if (this.settings.rememberExpanded) {
                    this.plugin.saveSettings().catch(Logger.error);
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
                    
                    let index = -1;
                    if (preferredContextId) {
                        index = items.findIndex(item =>
                            item.node.path === filePath && item.contextId === preferredContextId
                        );
                        
                        if (index === -1) {
                            index = items.findIndex(item =>
                                item.node.path === filePath &&
                                (item.parentPath === preferredContextId ||
                                 (item.contextId && preferredContextId && item.contextId.startsWith(preferredContextId + " > ")))
                            );
                        }
                    }
                    
                    if (index === -1) {
                        index = items.findIndex(item => item.node.path === filePath);
                    }
                    
                    if (index !== -1) {
                        const scrollContainer = this.contentEl.querySelector('.abstract-folder-virtual-wrapper') as HTMLElement;
                        if (scrollContainer) {
                            const itemHeight = 24; // Fixed height from VirtualTreeManager
                            const top = index * itemHeight;
                            
                            const containerHeight = scrollContainer.clientHeight;
                            const scrollTop = Math.round(scrollContainer.scrollTop);
                            
                            const isVisible = (top >= scrollTop - 1) && (top + itemHeight <= scrollTop + containerHeight + 1);
                            
                            // If this was an internal click, we only scroll if the expansion of other branches
                            // shifted the current item out of view.
                            if (shouldSkipScroll && isVisible) {
                                return;
                            }

                            // Always scroll to the top position if not visible or if we want to ensure it's at the top
                            scrollContainer.scrollTo({ top: top, behavior: 'smooth' });
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
