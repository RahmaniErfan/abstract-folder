import { App, setIcon, TFolder, TFile, Notice, debounce } from "obsidian";
import type AbstractFolderPlugin from "../../../../../main";
import { Logger } from "../../../../utils/logger";
import { CatalogService } from "../../services/catalog-service";
import { CatalogItem, LibraryNode } from "../../types";
import { LibraryInfoModal } from "../modals/library-info-modal";
import { CatalogModal } from "../modals/catalog-modal";
import { TopicSubscriptionModal } from "../modals/topic-subscription-modal";

export interface LibraryShelfOptions {
    containerEl: HTMLElement;
    searchQuery: string;
    onLibrarySelect: (library: LibraryNode) => void;
    onCatalogItemSelect: (item: CatalogItem) => void;
    onSearch: (query: string) => void;
}

export class LibraryShelf {
    private isRefreshing = false;
    private nextRefreshScheduled = false;
    private searchInput: HTMLInputElement;
    private clearSearchBtn: HTMLElement;

    constructor(
        private app: App,
        private plugin: AbstractFolderPlugin,
        private catalogService: CatalogService,
        private options: LibraryShelfOptions
    ) {}

    async render() {
        const { containerEl } = this.options;
        containerEl.empty();
        
        const titleRow = containerEl.createDiv({ cls: "library-shelf-title-row" });
        titleRow.createEl("h2", { text: "Library Catalog", cls: "shelf-title" });
        
        const infoIcon = titleRow.createDiv({ 
            cls: "clickable-icon af-library-info-icon",
            attr: { "aria-label": "About Libraries & Registries" }
        });
        setIcon(infoIcon, "alert-circle");
        infoIcon.addEventListener("click", () => {
            new LibraryInfoModal(this.app).open();
        });

        const searchRow = containerEl.createDiv({ cls: "library-shelf-search-row" });
        this.renderSearch(searchRow, "Search catalog...", () => {
            void this.refreshShelf(shelfContainer);
        });

        const officialCatalogBtn = searchRow.createEl("button", {
            text: "View Catalogs",
            cls: "library-open-center-btn"
        });
        officialCatalogBtn.addEventListener("click", () => {
            new CatalogModal(this.plugin.app, this.plugin).open();
        });

        containerEl.createDiv({ cls: "library-header-divider" });

        const shelfContainer = containerEl.createDiv({ cls: "library-shelf" });
        await this.refreshShelf(shelfContainer);
    }

    private renderSearch(container: HTMLElement, placeholder: string, onSearch: () => void): HTMLElement {
        const searchContainer = container.createDiv({ cls: "abstract-folder-search-container" });
        const wrapper = searchContainer.createDiv({ cls: "abstract-folder-search-input-wrapper" });
        
        this.searchInput = wrapper.createEl("input", {
            type: "text",
            placeholder: placeholder,
            cls: "abstract-folder-search-input",
            value: this.options.searchQuery
        });

        this.clearSearchBtn = wrapper.createDiv({
            cls: "abstract-folder-search-clear",
            attr: { "aria-label": "Clear search" }
        });
        setIcon(this.clearSearchBtn, "x");
        this.updateClearButtonState();

        const debouncedSearch = debounce(onSearch, 150);
        this.searchInput.addEventListener("input", () => {
            this.options.searchQuery = this.searchInput.value;
            this.options.onSearch(this.searchInput.value);
            this.updateClearButtonState();
            debouncedSearch();
        });

        this.clearSearchBtn.addEventListener("click", () => {
            this.options.searchQuery = "";
            this.options.onSearch("");
            this.searchInput.value = "";
            this.updateClearButtonState();
            this.searchInput.focus();
            onSearch();
        });

        return searchContainer;
    }

    private updateClearButtonState() {
        if (!this.clearSearchBtn) return;
        this.clearSearchBtn.toggleClass("is-active", this.options.searchQuery.length > 0);
    }

    async refreshShelf(container: HTMLElement) {
        if (this.isRefreshing) {
            this.nextRefreshScheduled = true;
            return;
        }
        this.isRefreshing = true;
        this.nextRefreshScheduled = false;

        try {
            container.empty();
            const rawLibraries = await this.plugin.abstractBridge.discoverLibraries(this.plugin.settings.library.librariesPath, true);
        
            const libraries = rawLibraries.filter(lib => {
                if (!this.options.searchQuery) return true;
                const name = (lib.file instanceof TFolder) ? lib.file.name : "";
                return name.toLowerCase().includes(this.options.searchQuery.toLowerCase());
            });

            if (libraries.length === 0) {
                container.addClass("is-empty");
                if (this.options.searchQuery) {
                    const emptyState = container.createDiv({ cls: "empty-state-container" });
                    emptyState.createEl("p", { text: "No matching libraries found.", cls: "empty-state" });
                } else {
                    const emptyState = container.createDiv({ cls: "empty-state-container" });
                    const openCatalogBtn = emptyState.createEl("button", { 
                        text: "View Catalogs",
                        cls: "library-open-center-btn"
                    });
                    openCatalogBtn.addEventListener("click", () => {
                        new CatalogModal(this.plugin.app, this.plugin).open();
                    });
                }
                return;
            }

            container.removeClass("is-empty");
            const cardContainer = container.createDiv({ cls: "library-card-grid" });

            // 1. Fetch Remote Catalog
            const catalogItems = await this.catalogService.fetchAllItems();

            // 2. Build Unified Map
            const installedMap = new Map<string, LibraryNode>();
            libraries.forEach(lib => {
                if (lib.file instanceof TFolder) {
                    installedMap.set(lib.file.name.toLowerCase(), lib);
                }
            });

            // 3. Render Cards
            const renderedLibraryNames = new Set<string>();

            // First, show installed libraries that are in the catalog
            catalogItems.forEach(item => {
                const installed = installedMap.get(item.name.toLowerCase());
                if (installed) {
                    this.renderLibraryCard(cardContainer, item, installed);
                    renderedLibraryNames.add(item.name.toLowerCase());
                }
            });

            // Then, show installed libraries NOT in the catalog (Custom/Local)
            libraries.forEach(lib => {
                if (lib.file instanceof TFolder && !renderedLibraryNames.has(lib.file.name.toLowerCase())) {
                    this.renderLibraryCard(cardContainer, {
                        id: lib.libraryId || lib.file.name,
                        name: lib.file.name,
                        author: "Local",
                        description: "Personally installed or custom library.",
                        repo: "",
                        category: "Local",
                        tags: []
                    }, lib);
                    renderedLibraryNames.add(lib.file.name.toLowerCase());
                }
            });

            // Finally, show discoverable libraries
            catalogItems.forEach(item => {
                if (!renderedLibraryNames.has(item.name.toLowerCase())) {
                    if (!this.options.searchQuery || item.name.toLowerCase().includes(this.options.searchQuery.toLowerCase())) {
                        this.renderLibraryCard(cardContainer, item, null);
                    }
                }
            });
        } catch (error) {
            Logger.error("LibraryShelf: Failed to refresh shelf", error);
        } finally {
            this.isRefreshing = false;
            if (this.nextRefreshScheduled) {
                this.nextRefreshScheduled = false;
                void this.refreshShelf(container);
            }
        }
    }

    private renderLibraryCard(container: HTMLElement, item: CatalogItem, installed: LibraryNode | null) {
        const card = container.createDiv({ cls: "library-explorer-card" });
        if (installed) card.addClass("is-installed");

        const isSyncing = installed ? this.plugin.libraryManager.isPublicSyncing(installed.path) : false;

        const info = card.createDiv({ cls: "library-card-info" });
        
        const iconContainer = info.createDiv({ cls: "library-card-icon" });
        if (isSyncing) {
            setIcon(iconContainer, "refresh-cw");
            iconContainer.addClass("af-spin");
        } else {
            setIcon(iconContainer, installed ? "library" : "cloud-download");
        }
        
        const textInfo = info.createDiv({ cls: "library-card-text-info" });
        textInfo.createDiv({ cls: "library-card-name", text: item.name });
        textInfo.createDiv({ cls: "library-card-author", text: `by ${item.author}` });
        
        const actions = card.createDiv({ cls: "library-card-actions-wrapper" });

        if (installed) {
            if (isSyncing) {
                actions.createDiv({ cls: "library-card-badge is-syncing", text: "Syncing..." });
            }

            const actionButtons = actions.createDiv({ cls: "af-library-detail-actions" });
            
            const supportBtn = actionButtons.createDiv({ 
                cls: "af-library-detail-action af-library-detail-heart",
                attr: { "aria-label": "Support" }
            });
            setIcon(supportBtn, "heart");
            supportBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const url = item.fundingUrl || (installed as any).fundingUrl;
                if (url) {
                    window.open(url, "_blank");
                } else {
                    new Notice("No support link available.");
                }
            });

            const uninstallBtn = actionButtons.createDiv({ 
                cls: "af-library-detail-action af-library-detail-uninstall",
                attr: { "aria-label": "Uninstall" }
            });
            setIcon(uninstallBtn, "trash");
            uninstallBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (installed.file) {
                    if (confirm(`Are you sure you want to uninstall ${item.name}?`)) {
                        await this.plugin.libraryManager.deleteLibrary(installed.file.path);
                        this.plugin.abstractBridge.invalidateCache();
                        new Notice(`Uninstalled ${item.name}`);
                        void this.render();
                    }
                }
            });

            // Manage Subscriptions Button (Settings icon)
            void (async () => {
                try {
                    const config = await this.plugin.libraryManager.validateLibrary(installed.path);
                    if (config.availableTopics && config.availableTopics.length > 0) {
                        const settingsBtn = actionButtons.createDiv({ 
                            cls: "af-library-detail-action af-manage-sub-btn",
                            attr: { "aria-label": "Manage Subscriptions" }
                        });
                        setIcon(settingsBtn, "settings");
                        settingsBtn.addEventListener("click", (e) => {
                            e.stopPropagation();
                            new TopicSubscriptionModal(this.app, config, installed.path, this.plugin.libraryManager, () => {
                                // Metadata updated
                            }).open();
                        });
                    }
                } catch (e) {}
            })();
        }

        card.addEventListener("click", () => {
            if (installed) {
                this.options.onLibrarySelect(installed);
            } else {
                this.options.onCatalogItemSelect(item);
            }
        });
    }
}
