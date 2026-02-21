import { ItemView, WorkspaceLeaf, Notice, FileSystemAdapter, setIcon, requestUrl, MarkdownRenderer } from "obsidian";
import { Logger } from "../../utils/logger";
import { CatalogItem } from "../types";
import { CatalogService } from "../services/catalog-service";
import { LibraryManager } from "../git/library-manager";
import type AbstractFolderPlugin from "main";

export const VIEW_TYPE_LIBRARY_CENTER = "abstract-library-center";

export class LibraryCenterView extends ItemView {
    private catalogService: CatalogService;
    private libraryManager: LibraryManager;
    private searchInput: HTMLInputElement;
    private filterSelect: HTMLSelectElement;
    private categorySelect: HTMLSelectElement;
    
    private sidebarEl: HTMLElement;
    private itemsListEl: HTMLElement;
    private detailEl: HTMLElement;
    
    private searchQuery: string = "";
    private activeFilter: string = "all";
    private activeCategory: string = "all";
    private allItems: CatalogItem[] = [];
    private selectedItem: CatalogItem | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: AbstractFolderPlugin) {
        super(leaf);
        this.catalogService = new CatalogService(this.plugin.settings.librarySettings);
        this.libraryManager = this.plugin.libraryManager;
    }

    getViewType(): string {
        return VIEW_TYPE_LIBRARY_CENTER;
    }

    getDisplayText(): string {
        return "Library Catalog";
    }

    getIcon(): string {
        return "library";
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("abstract-library-center");
        container.addClass("af-catalog-tab-content-container"); // Reuse modal tab container styles

        const header = container.createDiv({ cls: "af-modal-header" });
        header.createEl("h2", { text: "Library Catalog" });

        const layout = container.createDiv({ cls: "af-catalog-layout" });
        layout.style.height = "calc(100% - 60px)";
        
        // Sidebar
        this.sidebarEl = layout.createDiv({ cls: "af-catalog-sidebar" });
        this.renderSidebarHeader(this.sidebarEl);
        this.itemsListEl = this.sidebarEl.createDiv({ cls: "af-catalog-items-list" });
        
        // Detail Area
        this.detailEl = layout.createDiv({ cls: "af-catalog-detail" });
        this.detailEl.createEl("p", { text: "Select a library to see details", cls: "empty-text" });
        
        void this.refreshCatalog();
    }

    private renderSidebarHeader(container: HTMLElement) {
        const header = container.createDiv({ cls: "af-catalog-sidebar-header" });
        
        const searchWrapper = header.createDiv({ cls: "af-catalog-search-wrapper" });
        this.searchInput = searchWrapper.createEl("input", {
            type: "text",
            placeholder: "Search..."
        });

        const filtersRow = header.createDiv({ cls: "af-catalog-filters-row" });
        this.filterSelect = filtersRow.createEl("select", { cls: "dropdown" });
        this.categorySelect = filtersRow.createEl("select", { cls: "dropdown" });
        
        this.populateFilters();

        this.searchInput.addEventListener("input", () => {
            this.searchQuery = this.searchInput.value.toLowerCase();
            this.filterAndRenderItems();
        });

        this.filterSelect.addEventListener("change", () => {
            this.activeFilter = this.filterSelect.value;
            this.filterAndRenderItems();
        });

        this.categorySelect.addEventListener("change", () => {
            this.activeCategory = this.categorySelect.value;
            this.filterAndRenderItems();
        });
    }

    private populateFilters() {
        if (!this.filterSelect) return;
        this.filterSelect.empty();
        this.filterSelect.createEl("option", { value: "all", text: "All Catalogs" });
        this.filterSelect.createEl("option", { value: "official", text: "Official" });
        this.filterSelect.createEl("option", { value: "standalone", text: "Standalone" });
        
        this.plugin.settings.librarySettings.catalogs.forEach((reg, index) => {
            this.filterSelect.createEl("option", { value: reg, text: `Custom ${index + 1}` });
        });
        
        this.filterSelect.value = this.activeFilter;

        this.categorySelect.empty();
        this.categorySelect.createEl("option", { value: "all", text: "All Categories" });
        this.catalogService.categories.forEach(cat => {
            this.categorySelect.createEl("option", { value: cat, text: cat });
        });
        this.categorySelect.value = this.activeCategory;
    }

    private async refreshCatalog() {
        if (!this.itemsListEl) return;
        
        this.itemsListEl.empty();
        this.itemsListEl.createEl("p", { text: "Fetching libraries...", cls: "loading-text" });
        
        try {
            // Consolidated fetching (Official + Custom + Standalones)
            const items = await this.catalogService.fetchAllItems();
            this.allItems = items;
            this.filterAndRenderItems();
            this.populateFilters();
        } catch (error) {
            this.itemsListEl.empty();
            this.itemsListEl.createEl("p", { text: "Error fetching libraries.", cls: "empty-text" });
        }
    }

    private filterAndRenderItems() {
        let items = [...this.allItems];

        if (this.searchQuery) {
            items = items.filter(i =>
                i.name.toLowerCase().includes(this.searchQuery) ||
                i.description.toLowerCase().includes(this.searchQuery) ||
                i.tags.some(t => t.toLowerCase().includes(this.searchQuery))
            );
        }

        if (this.activeFilter === "official") {
            const OFFICIAL_URL = "https://raw.githubusercontent.com/RahmaniErfan/abstract-catalog/main/catalog.json";
            items = items.filter(i => i.sourceCatalog === OFFICIAL_URL);
        } else if (this.activeFilter === "standalone") {
            items = items.filter(i => i.sourceCatalog === "standalone");
        } else if (this.activeFilter !== "all") {
            items = items.filter(i => i.sourceCatalog === this.activeFilter);
        }

        if (this.activeCategory !== "all") {
            items = items.filter(i => i.category === this.activeCategory);
        }

        this.renderSidebarItems(items);
    }

    private renderSidebarItems(items: CatalogItem[]) {
        if (!this.itemsListEl) return;
        this.itemsListEl.empty();
        
        if (items.length === 0) {
            this.itemsListEl.createEl("p", { text: "No libraries found.", cls: "empty-text" });
            return;
        }

        items.forEach(item => {
            const itemEl = this.itemsListEl.createDiv({ cls: "af-catalog-item" });
            if (this.selectedItem && this.selectedItem.id === item.id) {
                itemEl.addClass("is-selected");
            }

            itemEl.createDiv({ text: item.name, cls: "af-catalog-item-title" });
            itemEl.createDiv({ text: item.category, cls: "af-catalog-item-category" });

            itemEl.addEventListener("click", () => {
                this.selectItem(item, itemEl);
            });
        });

        if (!this.selectedItem && items.length > 0) {
            this.selectItem(items[0], this.itemsListEl.firstChild as HTMLElement);
        } else if (this.selectedItem) {
            const refreshed = items.find(i => i.id === this.selectedItem?.id);
            if (refreshed) {
                this.renderLibraryDetail(refreshed);
            }
        }
    }

    private selectItem(item: CatalogItem, el: HTMLElement) {
        this.selectedItem = item;
        this.itemsListEl.querySelectorAll(".af-catalog-item").forEach(i => i.removeClass("is-selected"));
        el.addClass("is-selected");
        this.renderLibraryDetail(item);
    }

    private async renderLibraryDetail(item: CatalogItem) {
        if (!this.detailEl) return;
        this.detailEl.empty();

        const header = this.detailEl.createDiv({ cls: "af-library-detail-header" });
        
        const titleRow = header.createDiv({ cls: "af-library-detail-title-row" });
        titleRow.createEl("h2", { text: item.name });

        const meta = header.createDiv({ cls: "af-library-detail-meta" });
        meta.createSpan({ text: `By ${item.author}`, cls: "author" });
        meta.createSpan({ text: item.category, cls: "category" });

        const actions = header.createDiv({ cls: "af-library-detail-actions" });
        
        if (item.fundingUrl) {
            const heart = actions.createDiv({ cls: "af-library-detail-action af-library-detail-heart clickable-icon", attr: { "aria-label": "Support" } });
            setIcon(heart, "heart");
            heart.addEventListener("click", () => window.open(item.fundingUrl, "_blank"));
        }
        
        const librariesPath = this.plugin.settings.librarySettings.librariesPath;
        const destPath = `${librariesPath}/${item.name}`;
        
        // Robust check: Check if folder exists AND contains library.json with matching ID
        let isInstalled = false;
        if (await this.app.vault.adapter.exists(destPath)) {
            try {
                const configPath = `${destPath}/library.json`;
                const content = await this.app.vault.adapter.read(configPath);
                const config = JSON.parse(content);
                isInstalled = config.id === item.id;
            } catch {
                isInstalled = true; 
            }
        }

        if (isInstalled) {
            const uninstallBtn = actions.createEl("button", { text: "Uninstall", cls: "mod-warning" });
            uninstallBtn.addEventListener("click", () => this.uninstallLibrary(item, uninstallBtn));
        } else {
            const installBtn = actions.createEl("button", { text: "Install", cls: "mod-cta" });
            installBtn.addEventListener("click", () => this.installLibrary(item, installBtn));
        }

        const ghBtn = actions.createEl("button", { text: "View on GitHub" });
        ghBtn.addEventListener("click", () => window.open(item.repositoryUrl, "_blank"));

        const body = this.detailEl.createDiv({ cls: "af-library-detail-body markdown-rendered" });
        body.createEl("p", { text: "Loading README...", cls: "loading-text" });

        void (async () => {
            try {
                if (!item.repositoryUrl) {
                    body.empty();
                    body.createEl("p", { text: "No repository URL available." });
                    return;
                }
                
                let readmeUrl = item.repositoryUrl;
                if (readmeUrl.includes("github.com")) {
                    readmeUrl = readmeUrl.replace("github.com", "raw.githubusercontent.com") + "/main/README.md";
                } else {
                    body.empty();
                    body.createEl("p", { text: "README preview only supported for GitHub." });
                    return;
                }

                const response = await requestUrl({ url: readmeUrl });
                if (response.status === 200) {
                    body.empty();
                    await MarkdownRenderer.render(this.app, response.text, body, "", this.plugin);
                } else {
                    body.empty();
                    body.createEl("p", { text: "Failed to load README.md" });
                }
            } catch (error) {
                body.empty();
                body.createEl("p", { text: "Error loading README: " + String(error) });
            }
        })();
    }

    private async installLibrary(item: CatalogItem, btn?: HTMLButtonElement) {
        if (btn) {
            btn.disabled = true;
            btn.setText("Installing...");
        }

        try {
            const librariesPath = this.plugin.settings.librarySettings.librariesPath;
            const destPath = `${librariesPath}/${item.name}`;

            Logger.debug(`[LibraryCenterView] installLibrary triggered`);
            Logger.debug(`[LibraryCenterView] Item ID: ${item.id}`);
            Logger.debug(`[LibraryCenterView] Item Name: ${item.name}`);
            Logger.debug(`[LibraryCenterView] Repository URL: ${item.repositoryUrl}`);
            Logger.debug(`[LibraryCenterView] Destination Path: ${destPath}`);

            new Notice(`Installing ${item.name}...`);
            await this.libraryManager.cloneLibrary(item.repositoryUrl, destPath, item);
            
            new Notice(`Successfully installed ${item.name}`);
            if (btn) {
                btn.setText("Installed");
                btn.disabled = true;
            }
            
            this.plugin.app.workspace.trigger("abstract-folder:graph-updated");
            this.plugin.app.workspace.trigger("abstract-folder:library-changed");
            
            if (this.selectedItem && this.selectedItem.id === item.id) {
                this.renderLibraryDetail(item);
            }
        } catch (error) {
            console.error(error);
            new Notice(`Failed to install ${item.name}: ${error instanceof Error ? error.message : String(error)}`);
            if (btn) {
                btn.disabled = false;
                btn.setText("Install");
            }
        }
    }

    private async uninstallLibrary(item: CatalogItem, btn?: HTMLButtonElement) {
        if (btn) {
            btn.disabled = true;
            btn.setText("Uninstalling...");
        }

        try {
            const librariesPath = this.plugin.settings.librarySettings.librariesPath;
            const destPath = `${librariesPath}/${item.name}`;
            
            await this.libraryManager.deleteLibrary(destPath);
            new Notice(`Successfully uninstalled ${item.name}`);
            
            this.plugin.app.workspace.trigger("abstract-folder:graph-updated");
            this.plugin.app.workspace.trigger("abstract-folder:library-changed");
            
            if (this.selectedItem && this.selectedItem.id === item.id) {
                this.renderLibraryDetail(item);
            }
        } catch (error) {
            console.error(error);
            new Notice(`Failed to uninstall ${item.name}`);
            if (btn) {
                btn.disabled = false;
                btn.setText("Uninstall");
            }
        }
    }

    async onClose() {}
}
