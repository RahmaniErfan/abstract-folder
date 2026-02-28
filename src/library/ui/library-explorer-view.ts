import { ItemView, WorkspaceLeaf, setIcon, TFolder, TFile, Platform, Notice, debounce, requestUrl, MarkdownRenderer } from "obsidian";
import type AbstractFolderPlugin from "../../../main";
import { Logger } from "../../utils/logger";
import { VirtualViewport, ViewportDelegate } from "../../ui/components/virtual-viewport";
import { ContextEngine } from "../../core/context-engine";
import { AbstractNode } from "../../core/tree-builder";
import { ScopedContentProvider } from "../../core/content-provider";
import { AbstractFolderToolbar } from "../../ui/toolbar/abstract-folder-toolbar";
import { AbstractDashboardModal } from "../../ui/modals/abstract-dashboard-modal";
import { LibraryInfoModal } from "../../ui/modals/library-info-modal";
import { CatalogModal } from "../../ui/modals/catalog-modal";
import { CatalogService } from "../../library/services/catalog-service";
import { CatalogItem, LibraryConfig, LibraryNode } from "../types";
import { TopicSubscriptionModal } from "../../ui/modals/topic-subscription-modal";

export const VIEW_TYPE_LIBRARY_EXPLORER = "abstract-library-explorer";

/**
 * LibraryExplorerView provides a dedicated interface for browsing installed libraries.
 * It features a "Shelf" view with pill-shaped selection and a scoped "Tree" view for the selected library.
 */
export class LibraryExplorerView extends ItemView implements ViewportDelegate {
    private viewport: VirtualViewport | null = null;
    private contextEngine: ContextEngine;
    private catalogService: CatalogService;
    private selectedLibrary: LibraryNode | null = null;
    private selectedTopic: string | null = null; // V2: Track selected topic (Level 2 -> Level 3)
    private selectedCatalogItem: CatalogItem | null = null;
    private currentItems: AbstractNode[] = [];
    private searchQuery: string = "";
    private searchInput: HTMLInputElement;
    private clearSearchBtn: HTMLElement;
    private isRefreshing = false;
    private nextRefreshScheduled = false;
    private isRenderingView = false;
    private isOwner = false;
    private repositoryUrl: string | null = null;
    private authorName = "Unknown";
    private scopeUnsubscribe: (() => void) | null = null;
    private debouncedRefreshLibraryTree: (options?: { forceExpand?: boolean }) => void;
    private debouncedRenderView: () => void;


    // Search Options
    private showAncestors = true;
    private showDescendants = true;

    constructor(leaf: WorkspaceLeaf, private plugin: AbstractFolderPlugin) {
        super(leaf);
        this.contextEngine = new ContextEngine(plugin, 'library');
        this.catalogService = new CatalogService(plugin.settings.librarySettings);
        this.debouncedRefreshLibraryTree = debounce(this.refreshLibraryTree.bind(this), 20);
        // 300ms debounce prevents duplicate renders from rapid file events after a git sync
        this.debouncedRenderView = debounce(this.renderView.bind(this), 300);
    }

    getViewType(): string {
        return VIEW_TYPE_LIBRARY_EXPLORER;
    }

    getDisplayText(): string {
        return "Library Catalog";
    }

    getIcon(): string {
        return "library";
    }

    async onOpen() {
        // @ts-ignore - Internal workspace event
        this.registerEvent(this.app.workspace.on("abstract-folder:library-changed", () => {
            this.renderView();
        }));

        // @ts-ignore
        this.registerEvent(this.app.workspace.on("abstract-folder:group-changed", () => {
            this.renderView();
        }));
        // @ts-ignore - Internal workspace event
        this.registerEvent(this.app.workspace.on("abstract-folder:git-refreshed", async (vaultPath?: string) => {
            // Surgical DOM Repainting
            // We only need to repaint if we are actually looking at the repo that changed
            if (this.selectedLibrary && this.selectedLibrary.file && this.viewport && vaultPath) {
                const repoPath = this.selectedLibrary.file.path;
                if (vaultPath.startsWith(repoPath) || repoPath.startsWith(vaultPath)) {
                    // 1. Fetch the fresh matrix to update the underlying AbstractNode data model
                    const matrix = await this.plugin.libraryManager.getFileStatuses(repoPath);
                    
                    // 2. Update the syncStatus on our current flat list of nodes
                    for (const node of this.currentItems) {
                        const relativePath = (repoPath !== "" && node.id.startsWith(repoPath)) ? 
                            (node.id === repoPath ? "" : node.id.substring(repoPath.length + 1)) : node.id;
                        const status = matrix.get(relativePath);
                        node.syncStatus = status || undefined;
                    }
                    
                    // 3. Command the VirtualViewport to surgically repaint only what's on screen
                    this.viewport.forceUpdateVisibleRows();
                }
            }
        }));
        
        // Listen for library-removal or full-rebuild events
        // @ts-ignore
        this.registerEvent(this.app.workspace.on("abstract-folder:spaces-updated", () => {
            this.debouncedRenderView();
        }));

        // Listen for graph updates (e.g. new files) to refresh the tree.
        // IMPORTANT: use debouncedRefreshLibraryTree (not full renderView) to avoid
        // rebuilding the entire DOM on every file change that fires after a git pull.
        // @ts-ignore
        this.registerEvent(this.app.workspace.on("abstract-folder:graph-updated", () => {
            if (this.selectedLibrary) {
                this.debouncedRefreshLibraryTree();
            } else {
                // Debounced so that rapid post-pull file events don't create multiple shelf renders
                this.debouncedRenderView();
            }
        }));

        // Subscribe to context changes
        this.contextEngine.on('changed', () => {
            if (this.selectedLibrary) {
                this.debouncedRefreshLibraryTree();
            }
        });

        this.contextEngine.on('expand-all', () => {
            if (this.selectedLibrary) {
                this.debouncedRefreshLibraryTree({ forceExpand: true });
            }
        });

        this.renderView();
    }

    private renderView() {
        // Guard: if a full render is already in progress, skip to avoid DOM duplication
        if (this.isRenderingView) return;
        this.isRenderingView = true;

        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("abstract-library-explorer");

        const finish = () => { this.isRenderingView = false; };

        if (this.selectedLibrary) {
            if (this.selectedTopic) {
                this.renderLibraryTree(container).then(finish).catch((e) => { Logger.error("renderView", e); finish(); });
            } else {
                this.renderTopicScreen(container).then(finish).catch((e) => { Logger.error("renderView", e); finish(); });
            }
        } else if (this.selectedCatalogItem) {
            this.renderDiscoveryDetail(container).then(finish).catch((e) => { Logger.error("renderView", e); finish(); });
        } else {
            this.renderShelf(container).then(finish).catch((e) => { Logger.error("renderView", e); finish(); });
        }
    }

    private renderSearch(container: HTMLElement, placeholder: string, onSearch: () => void, includeOptions = false): HTMLElement {
        const searchContainer = container.createDiv({ cls: "abstract-folder-search-container" });
        const wrapper = searchContainer.createDiv({ cls: "abstract-folder-search-input-wrapper" });
        
        this.searchInput = wrapper.createEl("input", {
            type: "text",
            placeholder: placeholder,
            cls: "abstract-folder-search-input",
            value: this.searchQuery
        });

        this.clearSearchBtn = wrapper.createDiv({
            cls: "abstract-folder-search-clear",
            attr: { "aria-label": "Clear search" }
        });
        setIcon(this.clearSearchBtn, "x");
        this.updateClearButtonState();

        this.searchInput.addEventListener("input", () => {
            this.searchQuery = this.searchInput.value;
            this.updateClearButtonState();
            onSearch();
        });

        this.clearSearchBtn.addEventListener("click", () => {
            this.searchQuery = "";
            this.searchInput.value = "";
            this.updateClearButtonState();
            this.searchInput.focus();
            onSearch();
        });

        if (includeOptions) {
            const showAncestorsBtn = searchContainer.createDiv({
                cls: "clickable-icon ancestry-search-toggle",
                attr: { "aria-label": "Show all ancestors in search" }
            });
            setIcon(showAncestorsBtn, "arrow-up-left");
            if (this.showAncestors) showAncestorsBtn.addClass("is-active");

            showAncestorsBtn.addEventListener("click", () => {
                this.showAncestors = !this.showAncestors;
                showAncestorsBtn.toggleClass("is-active", this.showAncestors);
                onSearch();
            });

            const showDescendantsBtn = searchContainer.createDiv({
                cls: "clickable-icon ancestry-search-toggle",
                attr: { "aria-label": "Show all descendants in search" }
            });
            setIcon(showDescendantsBtn, "arrow-down-right");
            if (this.showDescendants) showDescendantsBtn.addClass("is-active");

            showDescendantsBtn.addEventListener("click", () => {
                this.showDescendants = !this.showDescendants;
                showDescendantsBtn.toggleClass("is-active", this.showDescendants);
                onSearch();
            });
        }

        return searchContainer;
    }

    private updateClearButtonState() {
        if (!this.clearSearchBtn) return;
        this.clearSearchBtn.toggleClass("is-active", this.searchQuery.length > 0);
    }

    private async renderShelf(container: HTMLElement) {
        const titleRow = container.createDiv({ cls: "library-shelf-title-row" });
        titleRow.createEl("h2", { text: "Library Catalog", cls: "shelf-title" });
        
        const infoIcon = titleRow.createDiv({ 
            cls: "clickable-icon af-library-info-icon",
            attr: { "aria-label": "About Libraries & Registries" }
        });
        setIcon(infoIcon, "alert-circle");
        infoIcon.addEventListener("click", () => {
            new LibraryInfoModal(this.app).open();
        });

        const searchRow = container.createDiv({ cls: "library-shelf-search-row" });
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

        container.createDiv({ cls: "library-header-divider" });

        const shelfContainer = container.createDiv({ cls: "library-shelf" });
        await this.refreshShelf(shelfContainer);
    }

    private async refreshShelf(container: HTMLElement) {
        if (this.isRefreshing) {
            this.nextRefreshScheduled = true;
            return;
        }
        this.isRefreshing = true;
        this.nextRefreshScheduled = false;

        try {
            container.empty();
            const rawLibraries = await this.plugin.abstractBridge.discoverLibraries(this.plugin.settings.librarySettings.librariesPath, true);
        
        const libraries = rawLibraries.filter(lib => {
            if (!this.searchQuery) return true;
            const name = (lib.file instanceof TFolder) ? lib.file.name : "";
            return name.toLowerCase().includes(this.searchQuery.toLowerCase());
        });

        if (libraries.length === 0) {
            container.addClass("is-empty");
            if (this.searchQuery) {
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
            // Find library.json to get the real ID
            if (lib.file instanceof TFolder) {
                // This is a bit slow, but discovery needs it to match IDs
                const configPath = `${lib.file.path}/library.json`;
                const file = this.app.vault.getAbstractFileByPath(configPath);
                if (file instanceof TFile) {
                    // We can't await reading every file here, let's use name-based match if file not readily available
                    // or just rely on the Discovery ID if we have it cached.
                    // For now, let's trust name-based clustering if ID is unknown.
                }
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
                    repositoryUrl: "",
                    category: "Local",
                    tags: []
                }, lib);
                renderedLibraryNames.add(lib.file.name.toLowerCase());
            }
        });

        // Finally, show discoverable libraries
        catalogItems.forEach(item => {
            if (!renderedLibraryNames.has(item.name.toLowerCase())) {
                if (!this.searchQuery || item.name.toLowerCase().includes(this.searchQuery.toLowerCase())) {
                    this.renderLibraryCard(cardContainer, item, null);
                }
            }
        });
        } catch (error) {
            Logger.error("LibraryExplorerView: Failed to refresh shelf", error);
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

        const iconContainer = card.createDiv({ cls: "library-card-icon" });
        setIcon(iconContainer, installed ? "library" : "cloud-download");
        
        const info = card.createDiv({ cls: "library-card-info" });
        info.createDiv({ cls: "library-card-name", text: item.name });
        info.createDiv({ cls: "library-card-author", text: `by ${item.author}` });
        
        if (installed) {
            card.createDiv({ cls: "library-card-badge", text: "Installed" });

            // Add Actions for installed libraries
            const actions = card.createDiv({ cls: "af-library-detail-actions" });
            
            // 1. Support Button (Heart)
            const supportBtn = actions.createDiv({ 
                cls: "af-library-detail-action af-library-detail-heart",
                attr: { "aria-label": "Support" }
            });
            setIcon(supportBtn, "heart");
            supportBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const url = item.fundingUrl || (this.selectedLibrary ? (this.selectedLibrary as any).fundingUrl : null);
                if (url) {
                    window.open(url, "_blank");
                } else {
                    new Notice("No support link available.");
                }
            });

            // 2. Uninstall Action
            const uninstallBtn = actions.createDiv({ 
                cls: "af-library-detail-action af-library-detail-uninstall",
                attr: { "aria-label": "Uninstall" }
            });
            setIcon(uninstallBtn, "trash");
            uninstallBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (installed.file) {
                    if (confirm(`Are you sure you want to uninstall ${item.name}?`)) {
                        await this.plugin.libraryManager.deleteLibrary(installed.file.path);
                        new Notice(`Uninstalled ${item.name}`);
                        this.renderView();
                    }
                }
            });

            // 3. View on GitHub
            const githubBtn = actions.createDiv({ 
                cls: "af-library-detail-action af-library-detail-github",
                attr: { "aria-label": "View on GitHub" }
            });
            setIcon(githubBtn, "github");
            githubBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (item.repositoryUrl) {
                    window.open(item.repositoryUrl, "_blank");
                }
            });
        }

        card.addEventListener("click", () => {
            if (installed) {
                this.selectedLibrary = installed;
                // V2: Set specific library scope to enable Topic Groups
                this.contextEngine = new ContextEngine(this.plugin, `library:${installed.libraryId}`);
            } else {
                this.selectedCatalogItem = item;
            }
            this.searchQuery = ""; 
            this.renderView();
        });
    }

    private async renderTopicScreen(container: HTMLElement) {
        if (!this.selectedLibrary || !this.selectedLibrary.file) return;

        // Level 2: Dedicated Topic Selection Screen
        // We do NOT call renderHeader here because we want a clean shelf-like view without the toolbar.
        const header = container.createDiv({ cls: "abstract-folder-header topic-screen-header" });
        const titleRow = header.createDiv({ cls: "abstract-folder-header-title-container" });
        
        const backBtn = titleRow.createDiv({ 
            cls: "af-header-back-button abstract-folder-toolbar-action clickable-icon", 
            attr: { "aria-label": "Back to Shelf" } 
        });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => {
            this.selectedLibrary = null;
            this.selectedTopic = null;
            this.renderView();
        });

        const titleEl = titleRow.createEl("h3", { cls: "abstract-folder-header-title" });
        titleEl.createSpan({ text: this.selectedLibrary.file.name });
        titleEl.createSpan({ cls: "af-header-subtitle", text: " » Select a Topic" });

        // Removed redundant library-header-divider as the title container already has a border-bottom

        const body = container.createDiv({ cls: "library-topic-screen" });
        // Use library-card-grid for consistent 24px padding and 20px gap matching the main shelf
        const grid = body.createDiv({ cls: "library-card-grid" });

        // 1. "All" Button (Always present)
        const allCard = grid.createDiv({ cls: "library-explorer-card all-card" });
        const allIcon = allCard.createDiv({ cls: "library-card-icon" });
        setIcon(allIcon, "layers");
        
        const allInfo = allCard.createDiv({ cls: "library-card-info" });
        allInfo.createDiv({ cls: "library-card-name", text: "All Topics" });
        allInfo.createDiv({ cls: "library-card-author", text: "View everything in this library." });
        
        allCard.addEventListener("click", () => {
            this.selectedTopic = 'all';
            this.contextEngine.setActiveTopic('all');
            this.renderView();
        });

        // 2. Fetch Subscribed Topics
        const libPath = this.selectedLibrary.file.path;
        console.log(`[LibraryExplorerView] Loading config for: ${libPath}`);
        const config = await this.plugin.libraryManager.validateLibrary(libPath).catch((e) => {
            console.error(`[LibraryExplorerView] validateLibrary failed for ${libPath}:`, e);
            return null;
        });
        
        const subscribed = config?.subscribedTopics || [];
        const available = config?.availableTopics || [];
        
        // Merge them for display (unique list)
        const topics = Array.from(new Set([...subscribed, ...available]));
        
        console.log(`[LibraryExplorerView] Subscribed:`, subscribed, `Available:`, available);
        console.log(`[LibraryExplorerView] Combined topics for display:`, topics);
        console.debug(`[LibraryExplorerView] Full config:`, config);

        topics.forEach((topic: string) => {
            const topicCard = grid.createDiv({ cls: "library-explorer-card" });
            const topicIcon = topicCard.createDiv({ cls: "library-card-icon" });
            setIcon(topicIcon, "folder");
            
            const topicInfo = topicCard.createDiv({ cls: "library-card-info" });
            topicInfo.createDiv({ cls: "library-card-name", text: topic });
            topicInfo.createDiv({ cls: "library-card-author", text: "Topic" });
            
            topicCard.addEventListener("click", () => {
                this.selectedTopic = topic;
                this.contextEngine.setActiveTopic(topic);
                this.renderView();
            });
        });

        if (topics.length === 0) {
            const emptyHint = body.createDiv({ cls: "topic-empty-hint" });
            emptyHint.createEl("p", { text: "No topics subscribed. You can manage subscriptions in Library Settings." });
        }
    }

    private async renderDiscoveryDetail(container: HTMLElement) {
        if (!this.selectedCatalogItem) return;
        const item = this.selectedCatalogItem;

        const header = container.createDiv({ cls: "abstract-folder-header" });
        const titleRow = header.createDiv({ cls: "abstract-folder-header-title-container" });
        const backBtn = titleRow.createDiv({ cls: "af-header-back-button abstract-folder-toolbar-action clickable-icon", attr: { "aria-label": "Back to shelf" } });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => {
            this.selectedCatalogItem = null;
            this.renderView();
        });

        const titleEl = titleRow.createEl("h3", { cls: "abstract-folder-header-title", text: item.name });
        
        // Removed redundant library-header-divider

        const body = container.createDiv({ cls: "library-discovery-body" });
        const hero = body.createDiv({ cls: "library-hero" });
        hero.createEl("p", { text: item.description, cls: "library-description" });
        
        const installBtn = hero.createEl("button", { text: "Install & Subscribe", cls: "mod-cta" });
        installBtn.addEventListener("click", async () => {
            installBtn.disabled = true;
            installBtn.setText("Checking topics...");
            const remoteConfig = await this.catalogService.fetchRemoteLibraryConfig(item.repositoryUrl);
            const librariesPath = this.plugin.settings.librarySettings.librariesPath;
            const destPath = `${librariesPath}/${item.name}`;

            if (remoteConfig && remoteConfig.availableTopics && remoteConfig.availableTopics.length > 0) {
                new TopicSubscriptionModal(this.app, remoteConfig, destPath, this.plugin.libraryManager, () => {
                    this.selectedCatalogItem = null;
                    this.renderView();
                }).open();
            } else {
                new Notice(`Installing ${item.name}...`);
                await this.plugin.libraryManager.cloneLibrary(item.repositoryUrl, destPath, item);
                new Notice("Installation complete");
                this.selectedCatalogItem = null;
                this.renderView();
            }
        });

        // Preview README
        const readmeArea = body.createDiv({ cls: "library-readme-preview markdown-rendered" });
        readmeArea.createEl("p", { text: "Loading details...", cls: "loading-text" });
        
        void (async () => {
            try {
                let readmeUrl = item.repositoryUrl;
                if (readmeUrl.includes("github.com")) {
                    readmeUrl = readmeUrl.replace("github.com", "raw.githubusercontent.com") + "/main/README.md";
                    const response = await requestUrl({ url: readmeUrl });
                    if (response.status === 200) {
                        readmeArea.empty();
                        await MarkdownRenderer.render(this.app, response.text, readmeArea, "", this.plugin);
                    }
                }
            } catch (e) {
                readmeArea.empty();
                readmeArea.createEl("p", { text: "Press Install to view this library." });
            }
        })();
    }

    private async renderLibraryTree(container: HTMLElement) {
        if (!this.selectedLibrary) return;

        const header = container.createDiv({ cls: "abstract-folder-header" });
        await this.renderHeader(header);

        // Removed redundant library-header-divider

        const treeContainer = container.createDiv({ cls: "abstract-folder-tree-container" });
        const scrollContainer = treeContainer.createDiv({ cls: "abstract-folder-viewport-scroll-container nav-files-container" });
        const spacerEl = scrollContainer.createDiv({ cls: "abstract-folder-viewport-spacer" });
        const contentEl = scrollContainer.createDiv({ cls: "abstract-folder-viewport-rows" });

        await this.renderBottomToolbar(container);

        Logger.debug("LibraryExplorerView: Mounting Viewport for selected library.");

        this.viewport = new VirtualViewport(
            contentEl,
            scrollContainer,
            spacerEl,
            this.contextEngine,
            this.plugin.scopeProjector,
            this,
            { showGroupHeader: true }
        );
        await this.refreshLibraryTree();
    }

    private async renderHeader(header: HTMLElement) {
        header.empty();

        const titleRow = header.createDiv({ cls: "abstract-folder-header-title-container" });
        const backBtn = titleRow.createDiv({ cls: "af-header-back-button abstract-folder-toolbar-action clickable-icon", attr: { "aria-label": "Back to shelf" } });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => {
            if (this.selectedTopic) {
                // From Level 3 to Level 2
                this.selectedTopic = null;
                this.contextEngine.setActiveTopic(null);
                this.renderView();
                return;
            }

            if (this.viewport) {
                this.viewport.destroy();
                this.viewport = null;
            }
            this.selectedLibrary = null;
            this.selectedTopic = null;
            this.searchQuery = ""; // Reset search when going back to shelf
            this.renderView();
        });

        if (this.selectedLibrary && this.selectedLibrary.file instanceof TFolder) {
            const meta = this.plugin.graphEngine?.getNodeMeta?.(this.selectedLibrary!.file.path);
            const iconToUse = meta?.icon || "library";
            
            const titleEl = titleRow.createEl("h3", { cls: "abstract-folder-header-title" });
            const iconEl = titleEl.createDiv({ cls: "af-header-icon" });
            
            if (this.selectedTopic) {
                setIcon(iconEl, this.selectedTopic === 'all' ? "layers" : "folder");
                titleEl.createSpan({ text: this.selectedTopic === 'all' ? "All Topics" : this.selectedTopic });
                titleEl.createSpan({ cls: "af-header-subtitle", text: ` in ${this.selectedLibrary!.file.name}` });
            } else {
                setIcon(iconEl, iconToUse);
                titleEl.createSpan({ text: this.selectedLibrary!.file.name });
            }
            
            // Pre-fetch ownership and repo info for toolbars
            const status = await this.plugin.libraryManager.isLibraryOwner(this.selectedLibrary!.file.path);
            this.isOwner = status.isOwner;
            this.authorName = status.author;
            this.repositoryUrl = status.repositoryUrl;
        }

        const visibility = this.plugin.settings.visibility.libraries;

        this.renderTopToolbar(header);

        if (visibility.showSearchHeader) {
            this.renderSearch(header, "Search in library...", () => {
                void this.refreshLibraryTree();
            }, true); // Enable options for tree view
        }
    }

    private async refreshLibraryTree(options: { forceExpand?: boolean } = {}) {
        if (!this.viewport || !this.selectedLibrary) return;
        
        if (this.isRefreshing) {
            this.nextRefreshScheduled = true;
            return;
        }
        this.isRefreshing = true;
        this.nextRefreshScheduled = false;

        try {
            const libraryFile = this.selectedLibrary.file;
            const libraryPath = libraryFile ? libraryFile.path : null;
            
            // Adjust scoping path if a specific topic is selected
            let effectiveScopingPath = libraryPath;
            if (this.selectedTopic && this.selectedTopic !== 'all' && libraryPath) {
                const requestedPath = `${libraryPath}/${this.selectedTopic}`;
                
                // Case-sensitivity Fix for Linux:
                // If the exact case doesn't exist, look for a case-insensitive match in the library folder.
                const abstractFile = this.app.vault.getAbstractFileByPath(requestedPath);
                if (!abstractFile) {
                    const libFolder = this.app.vault.getAbstractFileByPath(libraryPath);
                    if (libFolder instanceof TFolder) {
                        const match = libFolder.children.find(c => c.name.toLowerCase() === this.selectedTopic?.toLowerCase());
                        if (match) {
                            console.log(`[LibraryExplorerView] Case-correction: Resolved "${this.selectedTopic}" to "${match.name}"`);
                            effectiveScopingPath = match.path;
                        } else {
                            console.warn(`[LibraryExplorerView] Could not resolve topic path: ${requestedPath}`);
                            effectiveScopingPath = requestedPath;
                        }
                    } else {
                        effectiveScopingPath = requestedPath;
                    }
                } else {
                    effectiveScopingPath = requestedPath;
                }
            }
            
            console.log(`[LibraryExplorerView] Effective scoping path: ${effectiveScopingPath}`);
        
            // Strategic Cache Ingestion
            if (effectiveScopingPath) {
                // If it's a specific topic, we might still want the library's relationships seeded
                // but for V2 Pure Mirror, seeding is less critical than scoping.
                // However, seeding the whole library helps maintain links across topics.
                const relationships = this.plugin.abstractBridge.getLibraryRelationships(libraryPath || "");
                if (relationships) {
                    this.plugin.graphEngine.seedRelationships(relationships);
                }
            }

            // Create Scoped Provider for Library/Topic
            // Use 'library' scope ID to match ContextEngine
            const provider = new ScopedContentProvider(
                this.plugin.app,
                this.plugin.settings,
                effectiveScopingPath || "",
                this.contextEngine.getScope(),
                true, // Enable groupings
                this.contextEngine.getState().activeGroupId
            );

            const generator = this.plugin.treeBuilder.buildTree(
                this.contextEngine, 
                provider,
                { 
                    filterQuery: this.searchQuery,
                    forceExpandAll: !!this.searchQuery || !!options.forceExpand,
                    showAncestors: this.showAncestors, 
                    showDescendants: this.showDescendants 
                }
            );

            let result;
            while (true) {
                const next = await generator.next();
                if (next.done) {
                    result = next.value;
                    break;
                }
            }

            if (result) {
                this.currentItems = result.items;
                this.viewport.setItems(result.items);
                this.viewport.update();
            }
        } catch (error) {
            Logger.error("LibraryExplorerView: Failed to refresh library tree", error);
        } finally {
            this.isRefreshing = false;
            if (this.nextRefreshScheduled) {
                this.nextRefreshScheduled = false;
                void this.refreshLibraryTree(options);
            }
        }
    }

    private renderTopToolbar(container: HTMLElement) {
        const toolbarContainer = container.createDiv({ cls: "abstract-folder-toolbar" });
        
        const libraryPath = this.selectedLibrary?.file?.path || "";
        const provider = new ScopedContentProvider(
            this.plugin.app, 
            this.plugin.settings, 
            libraryPath, 
            this.contextEngine.getScope(),
            true, 
            this.contextEngine.getState().activeGroupId
        );

        const visibility = this.plugin.settings.visibility.libraries;

        new AbstractFolderToolbar(
            this.app,
            this.plugin.settings,
            this.plugin,
            this.contextEngine,
            {
                containerEl: toolbarContainer,
                provider: provider,
                showFocusButton: visibility.showFocusActiveFileButton,
                showConversionButton: visibility.showConversionButton,
                showCollapseButton: visibility.showCollapseAllButton,
                showExpandButton: visibility.showExpandAllButton,
                showSortButton: visibility.showSortButton,
                showFilterButton: visibility.showFilterButton,
                showGroupButton: visibility.showGroupButton,
                showCreateNoteButton: visibility.showCreateNoteButton && this.isOwner,
                extraActions: (toolbarEl: HTMLElement) => {
                    // GitHub actions moved to UnifiedDashboardView
                }
            }
        ).render();
    }



    private async renderBottomToolbar(container: HTMLElement) {
        const toolbar = container.createDiv({ cls: "af-status-bar" });
        
        const identityArea = toolbar.createDiv({ cls: "af-status-identity" });
        
        // Ownership check
        // Handled by renderLibraryTree pre-fetch
        const author = this.authorName;

        const libraryIcon = identityArea.createDiv({ cls: "af-status-library-icon" });
        setIcon(libraryIcon, "library");

        const infoArea = identityArea.createDiv({ cls: "library-bottom-info-row" });
        if (this.selectedLibrary?.file instanceof TFolder) {
            infoArea.createSpan({ cls: "af-status-username", text: this.selectedLibrary.file.name });
        }

        infoArea.createDiv({ 
            cls: `library-access-badge-pill ${this.isOwner ? 'is-owner' : 'is-readonly'}`,
            text: this.isOwner ? "Owner" : "Read-only"
        });

        const controlsArea = toolbar.createDiv({ cls: "af-status-controls" });

        if (this.isOwner) {
            // Share Button
            const shareBtn = controlsArea.createDiv({ 
                cls: "af-status-control clickable-icon", 
                attr: { "aria-label": "Library Info & Settings" } 
            });
            setIcon(shareBtn, "cloud");
            shareBtn.addEventListener("click", () => {
                if (!this.selectedLibrary?.file) return;
                new AbstractDashboardModal(
                    this.app,
                    this.plugin,
                    this.selectedLibrary.file.path,
                    this.selectedLibrary.file.name,
                    true
                ).open();
            });

            const pushBtn = controlsArea.createDiv({ 
                cls: "af-status-control af-status-sync-btn clickable-icon", 
                attr: { "aria-label": "Push changes to remote" } 
            });
            const pushIconContainer = pushBtn.createDiv({ cls: "af-status-sync-icon" });
            setIcon(pushIconContainer, "upload-cloud");
            const pushBadge = pushIconContainer.createDiv({ cls: "af-status-sync-badge push-badge is-hidden" });
            pushBadge.style.backgroundColor = "var(--color-blue)";
            
            pushBtn.addEventListener("click", async () => {
                if (!this.selectedLibrary?.file) return;
                try {
                    pushBtn.addClass("is-syncing");
                    new Notice("Pushing changes...");
                    await this.plugin.libraryManager.syncBackup(this.selectedLibrary.file.path, "Update library", undefined, true);
                    new Notice("Successfully pushed changes");
                } catch (e) {
                    new Notice(`Push failed: ${e.message}`);
                } finally {
                    pushBtn.removeClass("is-syncing");
                }
            });
        }

        const pullBtn = controlsArea.createDiv({ 
            cls: "af-status-control af-status-sync-btn clickable-icon", 
            attr: { "aria-label": "Pull updates from remote" } 
        });
        const pullIconContainer = pullBtn.createDiv({ cls: "af-status-sync-icon" });
        setIcon(pullIconContainer, "refresh-cw");
        const pullBadge = pullIconContainer.createDiv({ cls: "af-status-sync-badge pull-badge is-hidden" });

        pullBtn.addEventListener("click", async () => {
            if (!this.selectedLibrary?.file) return;
            try {
                pullBtn.addClass("is-syncing");
                new Notice("Updating library...");
                await this.plugin.libraryManager.updateLibrary(this.selectedLibrary.file.path);
                new Notice("Library updated");
                void this.refreshLibraryTree();
            } catch (e) {
                new Notice(`Update failed: ${e.message}`);
            } finally {
                pullBtn.removeClass("is-syncing");
            }
        });

        if (this.scopeUnsubscribe) {
            this.scopeUnsubscribe();
            this.scopeUnsubscribe = null;
        }

        const scopeId = this.selectedLibrary?.file?.path;
        if (scopeId) {
            const absPath = (this.plugin.libraryManager as any).getAbsolutePath(scopeId);
            this.plugin.libraryManager.scopeManager.registerScope(scopeId, absPath);

            this.scopeUnsubscribe = this.plugin.libraryManager.scopeManager.subscribe(scopeId, (state) => {
                if (this.isOwner) {
                    const pushIcon = toolbar.querySelector(".af-status-sync-icon .af-status-sync-badge.push-badge") as HTMLElement | null;
                    if (!pushIcon && (state.localChanges > 0 || state.ahead > 0)) {
                        const parent = toolbar.querySelectorAll(".af-status-sync-icon")[0] as HTMLElement | undefined;
                        if (parent) {
                            const badge = parent.createDiv({ cls: "af-status-sync-badge push-badge" });
                            badge.style.backgroundColor = "var(--color-blue)";
                            const count = state.localChanges + state.ahead;
                            badge.textContent = count > 9 ? "9+" : String(count);
                        }
                    } else if (pushIcon) {
                        const count = state.localChanges + state.ahead;
                        if (count > 0) {
                            pushIcon.textContent = count > 9 ? "9+" : String(count);
                            pushIcon.removeClass("is-hidden");
                        } else {
                            pushIcon.addClass("is-hidden");
                        }
                    }
                }
            });
        }
    }

    // ViewportDelegateV2 implementation
    getItemHeight(): number {
        return 24;
    }

    isMobile(): boolean {
        return Platform.isMobile;
    }

    onItemClick(node: AbstractNode, event: MouseEvent): void {
        this.contextEngine.select(node.uri, { multi: event.ctrlKey || event.metaKey });
        const file = this.app.vault.getAbstractFileByPath(node.id);
        if (file instanceof TFile) {
            void this.app.workspace.getLeaf(false).openFile(file);
        }
    }

    onItemToggle(node: AbstractNode, event: MouseEvent): void {
        this.contextEngine.toggleExpand(node.uri);
        void this.debouncedRefreshLibraryTree();
    }

    onItemContextMenu(node: AbstractNode, event: MouseEvent): void {
        const selection = this.contextEngine.getState().selectedURIs;

        this.plugin.contextMenuHandler.showV2ContextMenu(
            event,
            node,
            selection,
            this.currentItems,
            { isReadOnly: !this.isOwner }
        );
    }


    onItemDrop(draggedPath: string, targetNode: AbstractNode): void {
        // Library view might be read-only or have different D&D rules
    }

    async onClose() {
        if (this.viewport) {
            this.viewport.destroy();
            this.viewport = null;
        }
        if (this.scopeUnsubscribe) {
            this.scopeUnsubscribe();
            this.scopeUnsubscribe = null;
        }
        this.currentItems = [];
    }
}
