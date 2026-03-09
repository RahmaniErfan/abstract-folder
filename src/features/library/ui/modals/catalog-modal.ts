import { App, Modal, Notice, setIcon, requestUrl, MarkdownRenderer } from "obsidian";
import { Logger } from "../../../../utils/logger";
import type AbstractFolderPlugin from "../../../../../main";
import { CatalogItem, LibraryConfig } from "../../types";
import { CatalogService } from "../../services/catalog-service";
import { LibraryManager } from "../../../../core/git/library-manager";
import { TopicSubscriptionModal } from "./topic-subscription-modal";

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
        this.catalogService = new CatalogService(this.plugin.settings.library);
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
        
        // Ensure the modal structure is ready for flexbox
        this.modalEl.style.display = 'flex';
        this.modalEl.style.flexDirection = 'column';
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
        this.renderWelcomePage();
        
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
        
        this.plugin.settings.library.catalogs.forEach((reg, index) => {
            this.filterSelect.createEl("option", { value: reg, text: `Custom ${index + 1}` });
        });
        
        this.filterSelect.value = this.activeFilter;

        this.categorySelect.empty();
        this.categorySelect.createEl("option", { value: "all", text: "All Categories" });
        this.catalogService.categories.forEach((cat: string) => {
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
                (i.tags && i.tags.some(t => t.toLowerCase().includes(this.searchQuery)))
            );
        }

        if (this.activeFilter === "official") {
            const OFFICIAL_URL = "https://raw.githubusercontent.com/RahmaniErfan/abstract-catalog/main/.abstract/catalog.json";
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
        if (this.selectedItem) {
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

        const metaRow = header.createDiv({ cls: "af-library-detail-meta-row" });
        
        const authorInfo = metaRow.createDiv({ cls: "af-library-detail-meta" });
        authorInfo.createSpan({ text: "Author:", cls: "meta-label" });
        authorInfo.createSpan({ text: item.author, cls: "author" });

        const categoryInfo = metaRow.createDiv({ cls: "af-library-detail-meta" });
        categoryInfo.createSpan({ text: "Category:", cls: "meta-label" });
        categoryInfo.createSpan({ text: item.category, cls: "category" });

        const actions = metaRow.createDiv({ cls: "af-library-detail-actions" });
        
        if (item.fundingUrl) {
            const heart = actions.createDiv({ cls: "af-library-detail-action af-library-detail-heart clickable-icon", attr: { "aria-label": "Support" } });
            setIcon(heart, "heart");
            heart.addEventListener("click", () => window.open(item.fundingUrl, "_blank"));
        }
        
        const librariesPath = this.plugin.settings.library.librariesPath;
        const destPath = `${librariesPath}/${item.name}`;
        
        // Robust check: Check if folder exists AND contains library.json with matching ID
        let isInstalled = false;
        if (await this.app.vault.adapter.exists(destPath)) {
            try {
                const configPath = `${destPath}/library.json`;
                if (await this.app.vault.adapter.exists(configPath)) {
                    const content = await this.app.vault.adapter.read(configPath);
                    const config = JSON.parse(content);
                    isInstalled = (config.id === item.id) || (config.name === item.name);
                } else {
                    // Folder exists but no library.json. Check if it's empty or has other files.
                    const list = await this.app.vault.adapter.list(destPath);
                    isInstalled = list.files.length > 0 || list.folders.length > 0;
                }
            } catch {
                // Fallback for errors
                isInstalled = false; 
            }
        }

        if (isInstalled) {
            const actionsRow = actions.createDiv({ cls: "af-library-installed-actions" });
            const uninstallBtn = actionsRow.createDiv({ cls: "af-library-detail-action clickable-icon mod-warning", attr: { "aria-label": "Uninstall" } });
            setIcon(uninstallBtn, "trash");
            uninstallBtn.addEventListener("click", () => this.uninstallLibrary(item, uninstallBtn));

            // Handshake to see if we can manage subscriptions
            void (async () => {
                try {
                    const config = await this.libraryManager.validateLibrary(destPath);
                    if (config.availableTopics && config.availableTopics.length > 0) {
                        const manageBtn = actionsRow.createDiv({ cls: "af-library-detail-action clickable-icon af-manage-sub-btn", attr: { "aria-label": "Manage Subscriptions" } });
                        setIcon(manageBtn, "settings");
                        manageBtn.addEventListener("click", () => {
                            new TopicSubscriptionModal(this.app, config, destPath, this.libraryManager, () => {
                                this.renderLibraryDetail(item);
                            }).open();
                        });
                    }
                } catch (e) {}
            })();
        } else {
            const installBtn = actions.createDiv({ cls: "af-library-detail-action clickable-icon mod-cta", attr: { "aria-label": "Install" } });
            setIcon(installBtn, "download");
            installBtn.addEventListener("click", async () => {
                installBtn.style.pointerEvents = "none";
                installBtn.style.opacity = "0.5";
                setIcon(installBtn, "hourglass");

                try {
                    // Handshake: Fetch remote library.json
                    const remoteConfig = await this.catalogService.fetchRemoteLibraryConfig(item.repo);
                    
                    if (remoteConfig && remoteConfig.availableTopics && remoteConfig.availableTopics.length > 0) {
                        // Topic-aware library: Open subscription modal
                        new TopicSubscriptionModal(this.app, remoteConfig, destPath, this.libraryManager, () => {
                            this.renderLibraryDetail(item);
                        }).open();
                        setIcon(installBtn, "download");
                        installBtn.style.pointerEvents = "auto";
                        installBtn.style.opacity = "1";
                    } else {
                        // Standard library: Traditional install
                        this.installLibrary(item, installBtn);
                    }
                } catch (error) {
                    this.installLibrary(item, installBtn); // Fallback to standard
                }
            });
        }

        const ghBtn = actions.createDiv({ cls: "af-library-detail-action clickable-icon", attr: { "aria-label": "View on GitHub" } });
        setIcon(ghBtn, "github");
        ghBtn.addEventListener("click", () => {
            const githubUrl = item.repo.startsWith("http") ? item.repo : `https://github.com/${item.repo}`;
            window.open(githubUrl, "_blank");
        });

        const body = this.detailEl.createDiv({ cls: "af-library-detail-body markdown-rendered" });
        body.createEl("p", { text: "Loading README...", cls: "loading-text" });

        // Fetch and render README
        void (async () => {
            try {
                if (!item.repo) {
                    body.empty();
                    body.createEl("p", { text: "No repository URL available." });
                    return;
                }
                
                // Convert slug or URL to raw URL for README
                let readmeUrl = "";
                if (item.repo.includes("github.com")) {
                    readmeUrl = item.repo.replace("github.com", "raw.githubusercontent.com") + "/main/README.md";
                } else if (!item.repo.startsWith("http")) { // Assume github slug
                    readmeUrl = `https://raw.githubusercontent.com/${item.repo}/main/README.md`;
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
        const OFFICIAL_CATALOG_URL = "https://raw.githubusercontent.com/RahmaniErfan/abstract-catalog/main/.abstract/catalog.json";
        const manageSection = container.createDiv({ cls: "af-catalog-manage-section" });
        
        manageSection.createEl("h3", { text: "Manage Catalogs" });
        manageSection.createEl("p", { text: "Add the URL of a directory.json file from a custom Abstract Folder catalog.", cls: "af-manage-help-text" });

        // Official catalog — locked, cannot be removed
        const officialList = manageSection.createDiv({ cls: "af-manage-list" });
        const officialRow = officialList.createDiv({ cls: "af-manage-list-item af-manage-list-item--official" });
        const officialBadge = officialRow.createDiv({ cls: "af-manage-list-item-badge" });
        setIcon(officialBadge, "shield-check");
        officialBadge.setAttribute("aria-label", "Official");
        officialRow.createDiv({ cls: "af-manage-list-item-text", text: OFFICIAL_CATALOG_URL });
        const lockEl = officialRow.createDiv({ cls: "clickable-icon af-manage-list-item-lock", attr: { "aria-label": "Official catalog — cannot be removed" } });
        setIcon(lockEl, "lock");
        
        const catalogInputWrapper = manageSection.createDiv({ cls: "af-manage-input-row" });
        const catalogInput = catalogInputWrapper.createEl("input", {
            type: "text",
            placeholder: "e.g. raw.githubusercontent.com/.../directory.json"
        });
        const addCatalogBtn = catalogInputWrapper.createEl("button", { text: "Add Catalog" });

        const cataloguesList = manageSection.createDiv({ cls: "af-manage-list" });
        const customCatalogs = this.plugin.settings.library.catalogs.filter(r => r !== OFFICIAL_CATALOG_URL);
        this.renderManageList(cataloguesList, customCatalogs, (url) => {
            this.plugin.settings.library.catalogs = this.plugin.settings.library.catalogs.filter(r => r !== url);
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
        this.renderManageList(standaloneList, this.plugin.settings.library.standaloneLibraries, (url) => {
            this.plugin.settings.library.standaloneLibraries = this.plugin.settings.library.standaloneLibraries.filter(r => r !== url);
            this.plugin.saveSettings().then(() => this.renderManageTab(container));
        }, "No standalone libraries added yet.");

        // Event Listeners
        addCatalogBtn.addEventListener("click", () => {
            const url = catalogInput.value.trim();
            if (!url) return;
            if (!this.plugin.settings.library.catalogs.includes(url)) {
                this.plugin.settings.library.catalogs.push(url);
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
                    if (!this.plugin.settings.library.standaloneLibraries.includes(url)) {
                        this.plugin.settings.library.standaloneLibraries.push(url);
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

    private async installLibrary(item: CatalogItem, btn?: HTMLElement) {
        if (btn) {
            btn.style.pointerEvents = "none";
            btn.style.opacity = "0.5";
            setIcon(btn, "hourglass");
        }

        try {
            const librariesPath = this.plugin.settings.library.librariesPath;
            const destPath = `${librariesPath}/${item.name}`;

            Logger.debug(`[CatalogModal] installLibrary triggered`);
            Logger.debug(`[CatalogModal] Item ID: ${item.id}`);
            Logger.debug(`[CatalogModal] Item Name: ${item.name}`);
            Logger.debug(`[CatalogModal] Repository Slug: ${item.repo}`);
            Logger.debug(`[CatalogModal] Destination Path: ${destPath}`);

            new Notice(`Installing ${item.name}...`);
            const cloneUrl = item.repo.startsWith("http") ? item.repo : `https://github.com/${item.repo}`;
            await this.libraryManager.cloneLibrary(cloneUrl, destPath, item);
            
            new Notice(`Successfully installed ${item.name}`);
            if (btn) {
                setIcon(btn, "check");
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
                btn.style.pointerEvents = "auto";
                btn.style.opacity = "1";
                setIcon(btn, "download");
            }
        }
    }

    private async uninstallLibrary(item: CatalogItem, btn?: HTMLElement) {
        if (btn) {
            btn.style.pointerEvents = "none";
            btn.style.opacity = "0.5";
            setIcon(btn, "hourglass");
        }

        try {
            const librariesPath = this.plugin.settings.library.librariesPath;
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
                btn.style.pointerEvents = "auto";
                btn.style.opacity = "1";
                setIcon(btn, "trash");
            }
        }
    }

    private renderWelcomePage() {
        if (!this.detailEl) return;
        this.detailEl.empty();
        
        const welcome = this.detailEl.createDiv({ cls: "af-catalog-welcome" });
        welcome.createEl("h2", { text: "Welcome to Library Catalogs" });
        welcome.createEl("p", { 
            text: "This catalog allows you to discover and install community-maintained libraries for Abstract Folder. " +
                  "Libraries can be everything from community-based knowledge bases (University Notes, Personal Notes, topic-specific wikis) " +
                  "to pre-configured folder structures, templates, and scripts to enhance your Obsidian workflow."
        });
        
        const hints = welcome.createDiv({ cls: "af-catalog-welcome-hints" });
        hints.createEl("h3", { text: "How it works" });
        const list = hints.createEl("ul");
        list.createEl("li", { text: "Browse the available libraries in the sidebar." });
        list.createEl("li", { text: "Select a library to view its README and details." });
        list.createEl("li", { text: "Click 'Install' to add the library to your vault." });
        list.createEl("li", { text: "Managing Catalogs: You can add custom catalog URLs in the 'Manage Catalogs' tab." });

        const footer = welcome.createDiv({ cls: "af-catalog-welcome-footer" });
        footer.createEl("p", { text: "Select a library from the sidebar to get started." });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
