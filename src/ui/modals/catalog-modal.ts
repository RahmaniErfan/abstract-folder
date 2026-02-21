import { App, Modal, Notice, setIcon, requestUrl, MarkdownRenderer } from "obsidian";
import { Logger } from "../../utils/logger";
import type AbstractFolderPlugin from "main";
import { CatalogItem } from "../../library/types";
import { CatalogService } from "../../library/services/catalog-service";
import { LibraryManager } from "../../library/git/library-manager";

export class CatalogModal extends Modal {
    private catalogService: CatalogService;
    private libraryManager: LibraryManager;
    private searchInput: HTMLInputElement;
    private filterSelect: HTMLSelectElement;
    private categorySelect: HTMLSelectElement;
    
    // Layout elements
    private sidebarEl: HTMLElement;
    private itemsListEl: HTMLElement;
    private detailEl: HTMLElement;
    
    private searchQuery: string = "";
    private activeFilter: string = "all";
    private activeCategory: string = "all";
    private activeTab: 'browse' | 'manage' = 'browse';
    private allItems: CatalogItem[] = [];
    private selectedItem: CatalogItem | null = null;

    constructor(app: App, private plugin: AbstractFolderPlugin) {
        super(app);
        this.catalogService = new CatalogService(this.plugin.settings.librarySettings);
        this.libraryManager = this.plugin.libraryManager;
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.addClass("af-wide-modal");
        modalEl.addClass("abstract-catalog-modal");

        const header = contentEl.createDiv({ cls: "af-modal-header af-catalog-header-with-tabs" });
        header.createEl("h2", { text: "Library Catalogs", cls: "af-modal-title" });

        const tabsContainer = header.createDiv({ cls: "af-catalog-tabs" });
        const browseTab = tabsContainer.createDiv({ cls: "af-catalog-tab", text: "Browse Libraries" });
        const manageTab = tabsContainer.createDiv({ cls: "af-catalog-tab", text: "Manage Catalogs" });

        if (this.activeTab === 'browse') browseTab.addClass('is-active');
        if (this.activeTab === 'manage') manageTab.addClass('is-active');

        const tabContentContainer = contentEl.createDiv({ cls: "af-catalog-tab-content-container" });

        // Event listeners for tabs
        browseTab.addEventListener("click", () => {
            if (this.activeTab === 'browse') return;
            this.activeTab = 'browse';
            browseTab.addClass("is-active");
            manageTab.removeClass("is-active");
            this.renderTabContent(tabContentContainer);
        });

        manageTab.addEventListener("click", () => {
            if (this.activeTab === 'manage') return;
            this.activeTab = 'manage';
            manageTab.addClass("is-active");
            browseTab.removeClass("is-active");
            this.renderTabContent(tabContentContainer);
        });

        // Initial render
        this.renderTabContent(tabContentContainer);
    }

    private renderTabContent(container: HTMLElement) {
        container.empty();
        if (this.activeTab === 'browse') {
            this.renderBrowseTab(container);
        } else {
            this.renderManageTab(container);
        }
    }

    private renderBrowseTab(container: HTMLElement) {
        container.addClass("af-catalog-browse-tab");
        
        const layout = container.createDiv({ cls: "af-catalog-layout" });
        
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
        
        // Search
        const searchWrapper = header.createDiv({ cls: "af-catalog-search-wrapper" });
        this.searchInput = searchWrapper.createEl("input", {
            type: "text",
            placeholder: "Search..."
        });
        this.searchInput.value = this.searchQuery;

        // Filters Row
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
            
            // Repopulate categories in case they changed
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

        // Auto-select first item if nothing selected or current selection is gone
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
        header.createEl("h2", { text: item.name });

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
                // If no library.json or parse error, fallback to name-based check (legacy)
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

        // Fetch and render README
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

    private renderManageTab(container: HTMLElement) {
        const manageSection = container.createDiv({ cls: "af-catalog-manage-section" });
        
        manageSection.createEl("h3", { text: "Manage Custom Catalogs" });
        manageSection.createEl("p", { text: "Add the URL of a directory.json file from a custom Abstract Folder catalog.", cls: "af-manage-help-text" });
        
        const catalogInputWrapper = manageSection.createDiv({ cls: "af-manage-input-row" });
        const catalogInput = catalogInputWrapper.createEl("input", {
            type: "text",
            placeholder: "e.g. raw.githubusercontent.com/.../directory.json"
        });
        const addCatalogBtn = catalogInputWrapper.createEl("button", { text: "Add Catalog" });

        const cataloguesList = manageSection.createDiv({ cls: "af-manage-list" });
        this.renderManageList(cataloguesList, this.plugin.settings.librarySettings.catalogs, (url) => {
            this.plugin.settings.librarySettings.catalogs = this.plugin.settings.librarySettings.catalogs.filter(r => r !== url);
            this.plugin.saveSettings().then(() => this.renderManageTab(container));
        }, "No custom catalogs added yet.");

        manageSection.createEl("hr");

        manageSection.createEl("h3", { text: "Manage Standalone Libraries" });
        manageSection.createEl("p", { text: "Add the Git repository URL of a standalone Abstract Folder library.", cls: "af-manage-help-text" });

        const standaloneInputWrapper = manageSection.createDiv({ cls: "af-manage-input-row" });
        const standaloneInput = standaloneInputWrapper.createEl("input", {
            type: "text",
            placeholder: "e.g. https://github.com/RahmaniErfan/my-library"
        });
        const addStandaloneBtn = standaloneInputWrapper.createEl("button", { text: "Add Standalone" });

        const standaloneList = manageSection.createDiv({ cls: "af-manage-list" });
        this.renderManageList(standaloneList, this.plugin.settings.librarySettings.standaloneLibraries, (url) => {
            this.plugin.settings.librarySettings.standaloneLibraries = this.plugin.settings.librarySettings.standaloneLibraries.filter(r => r !== url);
            this.plugin.saveSettings().then(() => this.renderManageTab(container));
        }, "No standalone libraries added yet.");

        // Event Listeners
        addCatalogBtn.addEventListener("click", () => {
            const url = catalogInput.value.trim();
            if (!url) return;
            if (!this.plugin.settings.librarySettings.catalogs.includes(url)) {
                this.plugin.settings.librarySettings.catalogs.push(url);
                this.plugin.saveSettings().then(() => {
                    new Notice("Added custom catalog");
                    this.renderManageTab(container);
                });
            } else {
                new Notice("Catalog already exists");
            }
        });

        addStandaloneBtn.addEventListener("click", () => {
            void (async () => {
                const url = standaloneInput.value.trim();
                if (!url) return;
                
                addStandaloneBtn.disabled = true;
                addStandaloneBtn.setText("Resolving...");
                
                const item = await this.catalogService.resolveStandalone(url);
                if (item) {
                    await this.installLibrary(item);
                    if (!this.plugin.settings.librarySettings.standaloneLibraries.includes(url)) {
                        this.plugin.settings.librarySettings.standaloneLibraries.push(url);
                        await this.plugin.saveSettings();
                    }
                    this.renderManageTab(container);
                } else {
                    new Notice("Invalid or inaccessible repository URL");
                }
                
                addStandaloneBtn.disabled = false;
                addStandaloneBtn.setText("Add Standalone");
            })();
        });
    }

    private renderManageList(container: HTMLElement, items: string[], onDelete: (item: string) => void, emptyText: string) {
        if (items.length === 0) {
            container.createEl("p", { text: emptyText, cls: "af-manage-help-text" });
            return;
        }

        items.forEach(item => {
            const row = container.createDiv({ cls: "af-manage-list-item" });
            row.createDiv({ cls: "af-manage-list-item-text", text: item });
            
            const deleteBtn = row.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Remove" }});
            setIcon(deleteBtn, "trash");
            deleteBtn.addEventListener("click", () => {
                onDelete(item);
            });
        });
    }

    private async installLibrary(item: CatalogItem, btn?: HTMLButtonElement) {
        if (btn) {
            btn.disabled = true;
            btn.setText("Installing...");
        }

        try {
            const librariesPath = this.plugin.settings.librarySettings.librariesPath;
            const destPath = `${librariesPath}/${item.name}`;

            Logger.debug(`[CatalogModal] installLibrary triggered`);
            Logger.debug(`[CatalogModal] Item ID: ${item.id}`);
            Logger.debug(`[CatalogModal] Item Name: ${item.name}`);
            Logger.debug(`[CatalogModal] Repository URL: ${item.repositoryUrl}`);
            Logger.debug(`[CatalogModal] Destination Path: ${destPath}`);

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

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
