import { BaseFacet } from "./base-facet";
import { setIcon, App } from "obsidian";
import { Logger } from "../../utils/logger";
import { ContextEngine } from "../../core/context-engine";
import { TreeCoordinator } from "../../core/tree-coordinator";

/**
 * SearchFacet provides the filtering interface for the Abstract Folder view.
 */
export class SearchFacet extends BaseFacet {
    private searchInputEl: HTMLInputElement;

    constructor(
        treeCoordinator: TreeCoordinator,
        contextEngine: ContextEngine,
        containerEl: HTMLElement,
        private app: App
    ) {
        super(treeCoordinator, contextEngine, containerEl);
    }

    onMount(): void {
        this.containerEl.addClass("abstract-folder-search-facet");
        this.render();
    }

    private render() {
        this.containerEl.empty();

        const searchContainer = this.containerEl.createDiv({ cls: "abstract-folder-search-container" });
        
        this.searchInputEl = searchContainer.createEl("input", {
            cls: "abstract-folder-search-input",
            attr: {
                type: "text",
                placeholder: "Search notes...",
            }
        });

        this.searchInputEl.addEventListener("input", () => {
            this.contextEngine.setSearchQuery(this.searchInputEl.value);
        });

        const clearButton = searchContainer.createDiv({
            cls: "abstract-folder-search-clear clickable-icon",
            attr: { "aria-label": "Clear search" }
        });
        setIcon(clearButton, "x");
        clearButton.addEventListener("click", () => {
            this.searchInputEl.value = "";
            this.contextEngine.setSearchQuery("");
        });

        // Sync with engine state (e.g. if cleared from elsewhere)
        this.subscribe(this.contextEngine.subscribe((state) => {
            if (this.searchInputEl.value !== state.searchQuery) {
                this.searchInputEl.value = state.searchQuery;
            }
        }));
    }

    public focus() {
        if (this.searchInputEl) {
            this.searchInputEl.focus();
        }
    }
}
