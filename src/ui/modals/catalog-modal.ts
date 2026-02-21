import { App, Modal, Notice, setIcon } from "obsidian";
import type AbstractFolderPlugin from "main";
import { RegistryItem } from "../../library/types";
import { RegistryService } from "../../library/services/registry-service";
import { LibraryManager } from "../../library/git/library-manager";

export class CatalogModal extends Modal {
    private registryService: RegistryService;
    private libraryManager: LibraryManager;
    private searchInput: HTMLInputElement;
    private filterSelect: HTMLSelectElement;
    private registryList: HTMLElement;
    
    private searchQuery: string = "";
    private activeFilter: string = "all"; // 'all', 'official', 'standalone', or custom URL
    private activeTab: 'browse' | 'manage' = 'browse';

    constructor(app: App, private plugin: AbstractFolderPlugin) {
        super(app);
        this.registryService = new RegistryService(this.plugin.settings.librarySettings);
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
            this.activeTab = 'browse';
            browseTab.addClass("is-active");
            manageTab.removeClass("is-active");
            this.renderTabContent(tabContentContainer);
        });

        manageTab.addEventListener("click", () => {
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
        const controls = container.createDiv({ cls: "af-catalog-controls" });
        
        // Search
        const searchWrapper = controls.createDiv({ cls: "af-catalog-search-wrapper" });
        this.searchInput = searchWrapper.createEl("input", {
            type: "text",
            placeholder: "Search libraries by name, description, or tags..."
        });
        this.searchInput.value = this.searchQuery;

        // Filter Dropdown
        const filterWrapper = controls.createDiv({ cls: "af-catalog-filter-wrapper" });
        this.filterSelect = filterWrapper.createEl("select", { cls: "dropdown" });
        this.populateFilters();

        this.registryList = container.createDiv({ cls: "af-catalog-grid library-registry-list" });

        this.searchInput.addEventListener("input", () => {
            this.searchQuery = this.searchInput.value.toLowerCase();
            void this.refreshRegistry();
        });

        this.filterSelect.addEventListener("change", () => {
            this.activeFilter = this.filterSelect.value;
            void this.refreshRegistry();
        });

        void this.refreshRegistry();
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
        this.renderManageList(cataloguesList, this.plugin.settings.librarySettings.registries, (url) => {
            this.plugin.settings.librarySettings.registries = this.plugin.settings.librarySettings.registries.filter(r => r !== url);
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
            if (!this.plugin.settings.librarySettings.registries.includes(url)) {
                this.plugin.settings.librarySettings.registries.push(url);
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
                
                const item = await this.registryService.resolveStandalone(url);
                if (item) {
                    await this.installLibrary(item);
                    // Save to settings
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

    private populateFilters() {
        if (!this.filterSelect) return;
        this.filterSelect.empty();
        this.filterSelect.createEl("option", { value: "all", text: "All Catalogs & Standalone" });
        this.filterSelect.createEl("option", { value: "official", text: "Official Catalog" });
        this.filterSelect.createEl("option", { value: "standalone", text: "Standalone Libraries" });
        
        this.plugin.settings.librarySettings.registries.forEach((reg, index) => {
            this.filterSelect.createEl("option", { value: reg, text: `Custom Catalog ${index + 1}` });
        });
        
        this.filterSelect.value = this.activeFilter; // Restore active filter
    }

    private async refreshRegistry() {
        if (!this.registryList) return;
        
        this.registryList.empty();
        this.registryList.createEl("p", { text: "Fetching libraries...", cls: "loading-text" });
        
        let items = await this.registryService.fetchAllItems();
        
        // Fetch standalone items
        const standalones = this.plugin.settings.librarySettings.standaloneLibraries;
        for (const url of standalones) {
            const item = await this.registryService.resolveStandalone(url);
            if (item) {
                item.sourceCatalog = "standalone";
                items.push(item);
            }
        }

        // Apply string search
        if (this.searchQuery) {
            items = items.filter(i =>
                i.name.toLowerCase().includes(this.searchQuery) ||
                i.description.toLowerCase().includes(this.searchQuery) ||
                i.tags.some(t => t.toLowerCase().includes(this.searchQuery))
            );
        }

        // Apply catalog filter
        if (this.activeFilter === "official") {
            const OFFICIAL_URL = "https://raw.githubusercontent.com/RahmaniErfan/abstract-catalog/main/directory.json";
            items = items.filter(i => i.sourceCatalog === OFFICIAL_URL);
        } else if (this.activeFilter === "standalone") {
            items = items.filter(i => i.sourceCatalog === "standalone");
        } else if (this.activeFilter !== "all") {
            items = items.filter(i => i.sourceCatalog === this.activeFilter);
        }

        this.renderItems(items);
    }

    private renderItems(items: RegistryItem[]) {
        if (!this.registryList) return;
        this.registryList.empty();
        
        if (items.length === 0) {
            this.registryList.createEl("p", { text: "No libraries found.", cls: "empty-text" });
            return;
        }

        const librariesPath = this.plugin.settings.librarySettings.librariesPath;

        items.forEach(item => {
            const card = this.registryList.createDiv({ cls: "library-card" });
            card.createEl("h3", { text: item.name });
            card.createEl("p", { text: item.description });
            
            const meta = card.createDiv({ cls: "library-card-meta" });
            meta.createSpan({ text: `By ${item.author}`, cls: "author" });
            meta.createSpan({ text: item.category, cls: "category" });

            let sourceLabelText = "Custom";
            if (item.sourceCatalog === "https://raw.githubusercontent.com/RahmaniErfan/abstract-catalog/main/directory.json") {
                sourceLabelText = "Official";
            } else if (item.sourceCatalog === "standalone") {
                sourceLabelText = "Standalone";
            }
            meta.createSpan({ text: sourceLabelText, cls: "source-badge" });

            const footer = card.createDiv({ cls: "library-card-footer" });
            
            // Check if library is already installed
            const destPath = `${librariesPath}/${item.name}`;
            
            void (async () => {
                let isInstalled = false;
                try {
                    isInstalled = await this.app.vault.adapter.exists(destPath);
                } catch {
                    isInstalled = false;
                }

                if (isInstalled) {
                    const uninstallBtn = footer.createEl("button", { text: "Uninstall", cls: "mod-warning" });
                    uninstallBtn.addEventListener("click", () => {
                        void this.uninstallLibrary(item, uninstallBtn);
                    });
                } else {
                    const installBtn = footer.createEl("button", { text: "Install" });
                    installBtn.addEventListener("click", () => {
                        void this.installLibrary(item, installBtn);
                    });
                }
            })();
        });
    }

    private async installLibrary(item: RegistryItem, btn?: HTMLButtonElement) {
        if (btn) {
            btn.disabled = true;
            btn.setText("Installing...");
        }

        try {
            new Notice(`Installing ${item.name}...`);
            const librariesPath = this.plugin.settings.librarySettings.librariesPath;
            const destPath = `${librariesPath}/${item.name}`;
            
            await this.libraryManager.cloneLibrary(item.repositoryUrl, destPath, item);
            
            new Notice(`Successfully installed ${item.name}`);
            if (btn) btn.setText("Installed");
            
            this.plugin.app.workspace.trigger("abstract-folder:graph-updated");
            this.plugin.app.workspace.trigger("abstract-folder:library-changed");
            
            if (this.activeTab === 'browse') await this.refreshRegistry();
        } catch (error) {
            console.error(error);
            new Notice(`Failed to install ${item.name}: ${error instanceof Error ? error.message : String(error)}`);
            if (btn) {
                btn.disabled = false;
                btn.setText("Install");
            }
        }
    }

    private async uninstallLibrary(item: RegistryItem, btn?: HTMLButtonElement) {
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
            
            if (this.activeTab === 'browse') await this.refreshRegistry();
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
