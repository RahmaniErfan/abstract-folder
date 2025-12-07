import { App, TFile } from "obsidian";
import { AbstractFolderPluginSettings } from "./settings";
import { ViewState } from "./ui/view-state";
import { ColumnRenderer } from "./ui/column/column-renderer";
import { FolderIndexer } from "./indexer";
import AbstractFolderPlugin from "../main";

export class FileRevealManager {
    private app: App;
    private settings: AbstractFolderPluginSettings;
    private contentEl: HTMLElement;
    private viewState: ViewState;
    private indexer: FolderIndexer;
    private columnRenderer: ColumnRenderer;
    private renderView: () => void;
    private plugin: AbstractFolderPlugin;

    constructor(
        app: App,
        settings: AbstractFolderPluginSettings,
        contentEl: HTMLElement,
        viewState: ViewState,
        indexer: FolderIndexer,
        columnRenderer: ColumnRenderer,
        renderViewCallback: () => void,
        plugin: AbstractFolderPlugin
    ) {
        this.app = app;
        this.settings = settings;
        this.contentEl = contentEl;
        this.viewState = viewState;
        this.indexer = indexer;
        this.columnRenderer = columnRenderer;
        this.renderView = renderViewCallback;
        this.plugin = plugin;
    }

    public onFileOpen = async (file: TFile | null) => {
        if (!file) return;
        this.revealFile(file.path, this.settings.autoExpandParents);
    }

    public revealFile(filePath: string, expandParents: boolean = true) {
        if (this.settings.viewStyle === 'tree') {
            const fileNodeEls = this.contentEl.querySelectorAll(`.abstract-folder-item[data-path="${filePath}"]`);
            
            let hasExpandedOneParentChain = false; // Flag to ensure parent expansion happens only once across all paths

            fileNodeEls.forEach(itemEl => {
                // Ensure expandParents is true and autoExpandParents is enabled in settings
                if (expandParents && this.settings.autoExpandParents && !hasExpandedOneParentChain) {
                    let currentEl = itemEl.parentElement;
                    while (currentEl) {
                        if (currentEl.classList.contains("abstract-folder-children")) {
                            const parentItem = currentEl.parentElement;
                            if (parentItem) {
                                if (parentItem.hasClass("is-collapsed")) {
                                    parentItem.removeClass("is-collapsed");
                                    if (this.settings.rememberExpanded) {
                                        const parentPath = parentItem.dataset.path;
                                        if (parentPath && !this.settings.expandedFolders.includes(parentPath)) {
                                            this.settings.expandedFolders.push(parentPath);
                                            this.plugin.saveSettings();
                                        }
                                    }
                                }
                                currentEl = parentItem.parentElement;
                            } else {
                                break;
                            }
                        } else if (currentEl.classList.contains("abstract-folder-tree")) {
                            break;
                        } else {
                            currentEl = currentEl.parentElement;
                        }
                    }
                    hasExpandedOneParentChain = true; // Set the flag after the first parent chain has been processed
                }

                itemEl.scrollIntoView({ block: "nearest", behavior: "smooth" });

                // First, remove 'is-active' from any elements that are currently active but do not match the filePath
                this.contentEl.querySelectorAll(".abstract-folder-item-self.is-active").forEach(el => {
                    const parentItem = el.closest(".abstract-folder-item") as HTMLElement | null;
                    if (parentItem && parentItem.dataset.path !== filePath) {
                        el.removeClass("is-active");
                    }
                });

                // Then, ensure all instances of the *current* active file (filePath) are highlighted
                const selfElToHighlight = itemEl.querySelector(".abstract-folder-item-self");
                if (selfElToHighlight) {
                  selfElToHighlight.addClass("is-active");
                }
            });
        } else if (this.settings.viewStyle === 'column') {
            // Column view always needs to 'expand' to the active file's path
            const isPathAlreadySelected = this.viewState.selectionPath.includes(filePath);

            if (!isPathAlreadySelected) {
                const pathSegments = this.indexer.getPathToRoot(filePath);
                this.viewState.selectionPath = pathSegments;
            }
            this.columnRenderer.setSelectionPath(this.viewState.selectionPath);
            this.renderView();
            this.contentEl.querySelector(".abstract-folder-column:last-child")?.scrollIntoView({ block: "end", behavior: "smooth" });
        }
    }
}