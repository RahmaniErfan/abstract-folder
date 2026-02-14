import { ItemView, WorkspaceLeaf, setIcon, TFile, Notice, prepareSimpleSearch } from "obsidian";
import { FolderIndexer } from "../../indexer";
import { MetricsManager } from "../../metrics-manager";
import { FolderNode, HIDDEN_FOLDER_ID, Group } from "../../types";
import { AbstractFolderPluginSettings } from "../../settings";
import AbstractFolderPlugin from '../../../main';
import { TreeRenderer } from '../tree/tree-renderer';
import { ColumnRenderer } from '../column/column-renderer';
import { ViewState } from '../view-state';
import { buildFolderTree } from '../../utils/tree-utils';
import { createSortComparator } from '../../utils/sorting';
import { ContextMenuHandler } from "../context-menu";
import { AbstractFolderViewToolbar } from "../toolbar/abstract-folder-view-toolbar";
import { FileRevealManager } from "../../file-reveal-manager";
import { DragManager } from "../dnd/drag-manager";
import { VirtualTreeManager } from "./virtual-tree-manager";
import { AncestryEngine } from "../../utils/ancestry";
import { PathSuggest } from "../path-suggest";
import { Logger } from "../../utils/logger";

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

interface ExtendedHTMLElement extends HTMLElement {
    _folderNode?: FolderNode;
    _ancestors?: Set<string>;
    _contextId?: string;
}

export class AbstractFolderView extends ItemView {
  private indexer: FolderIndexer;
  private metricsManager: MetricsManager;
  private settings: AbstractFolderPluginSettings;
  contentEl: HTMLElement;

  private viewState: ViewState;
  private treeRenderer: TreeRenderer;
  private columnRenderer: ColumnRenderer;
  private contextMenuHandler: ContextMenuHandler;
  private toolbar: AbstractFolderViewToolbar;
  private fileRevealManager: FileRevealManager | undefined;
  private dragManager: DragManager;
  private resizeObserver: ResizeObserver | undefined;
  private virtualTreeManager: VirtualTreeManager;

  private isLoading = true;
  private isConverting = false;
  private conversionStatus = { processed: 0, total: 0, message: "" };

  private virtualContainer: HTMLElement | null = null;
  private virtualSpacer: HTMLElement | null = null;
  
  private searchHeaderEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private isSearchVisible = true;

  constructor(
    leaf: WorkspaceLeaf,
    indexer: FolderIndexer,
    settings: AbstractFolderPluginSettings,
    private plugin: AbstractFolderPlugin,
    metricsManager: MetricsManager
  ) {
    super(leaf);
    this.indexer = indexer;
    this.metricsManager = metricsManager;
    this.settings = settings;
    this.plugin = plugin;
    this.icon = "folder-tree";
    this.navigation = false;

    this.dragManager = new DragManager(this.app, this.settings, this.indexer, this as unknown as AbstractFolderView);
    this.viewState = new ViewState(this.settings, this.plugin);
    this.viewState.initializeSortAndFilter();
    
    this.treeRenderer = new TreeRenderer(
      this.app, this.settings, this.plugin,
      this.viewState.multiSelectedPaths,
      this.getDisplayName,
      (itemEl, path, contextId) => this.toggleCollapse(itemEl, path, contextId),
      this.indexer, this.dragManager,
      (path) => this.focusFile(path)
    );

    this.columnRenderer = new ColumnRenderer(
      this.app, this.settings, this.plugin,
      this.viewState.selectionPath,
      this.viewState.multiSelectedPaths,
      this.getDisplayName,
      (node, depth, event) => this.handleColumnNodeClick(node, depth, event),
      (node, depth) => this.handleColumnExpand(node, depth),
      this.indexer, this.dragManager,
      () => this.contentEl
    );

    this.contextMenuHandler = new ContextMenuHandler(this.app, this.settings, this.plugin, this.indexer, (path: string) => this.focusFile(path));
  }

  getViewType(): string { return VIEW_TYPE_ABSTRACT_FOLDER; }
  getDisplayText(): string { return "Abstract folder"; }

  public onOpen = async () => {
    this.contentEl = this.containerEl.children[1] as HTMLElement;
    this.contentEl.empty();
    this.contentEl.addClass("abstract-folder-view");
    
    const toolbarEl = this.contentEl.createDiv({ cls: "abstract-folder-toolbar-container" });
    this.toolbar = new AbstractFolderViewToolbar(
       this.app, this.settings, this.plugin, this.viewState, toolbarEl,
       () => { this.renderView(); }, () => { void this.expandAll(); }, () => { void this.collapseAll(); },
       () => {}, // Callback for search toggle (deprecated but kept for compat)
       () => this.focusSearch(),
       () => this.focusActiveFile()
    );

    const virtualWrapper = this.contentEl.createDiv({ cls: "abstract-folder-virtual-wrapper" });
    this.virtualSpacer = virtualWrapper.createDiv({ cls: "abstract-folder-virtual-spacer" });
    this.virtualContainer = virtualWrapper.createDiv({ cls: "abstract-folder-virtual-container" });
    
    this.virtualSpacer.toggleClass('abstract-folder-hidden', true);
    this.virtualContainer.toggleClass('abstract-folder-hidden', true);

    this.virtualTreeManager = new VirtualTreeManager(
        this.app, this.settings, this.indexer, this.viewState, this.treeRenderer,
        this.contentEl, this.virtualSpacer, this.virtualContainer, (a, b) => this.sortNodes(a, b)
        // We removed abstractBridge here. Libraries should only be visible in the Library Explorer.
    );

    await Promise.resolve();
    this.fileRevealManager = new FileRevealManager(
        this.app, this.settings, this.contentEl, this.viewState, this.indexer,
        this.columnRenderer, () => this.renderView(), this.plugin,
        this.virtualTreeManager
    );

    this.treeRenderer.fileRevealManager = this.fileRevealManager;

    this.toolbar.setupToolbarActions();
    this.renderView();

    this.registerViewEvents();
    this.registerConversionEvents();
    this.registerDomEvents();
    this.registerScopeHotkeys();
    
    if (!this.indexer.hasBuiltFirstGraph() && this.indexer.isGraphBuilding()) {
        this.isLoading = true;
    } else {
        this.isLoading = false; 
    }
  }

  private registerViewEvents() {
    // @ts-ignore - Custom event not in Obsidian types
    this.registerEvent(this.app.workspace.on("abstract-folder:graph-updated", () => {
        if (this.isConverting) return;
        this.isLoading = false;
        this.metricsManager.calculateGraphMetrics();
        this.renderView();
    }));
    // @ts-ignore - Custom event not in Obsidian types
    this.registerEvent(this.app.workspace.on("abstract-folder:graph-build-start", () => {
        this.isLoading = true;
        this.renderView();
    }));
    // @ts-ignore - Custom event not in Obsidian types
    this.registerEvent(this.app.workspace.on("abstract-folder:view-style-changed", this.handleViewStyleChanged, this));
    // @ts-ignore - Custom event not in Obsidian types
    this.registerEvent(this.app.workspace.on("abstract-folder:group-changed", () => {
        // When a group is changed (activated), we MUST clear the search to prevent mixed state
        // This ensures the view switches from "Search results" to "Group view" cleanly
        if (this.settings.activeGroupId && this.searchInputEl && this.searchInputEl.value.trim().length > 0) {
            this.searchInputEl.value = "";
            // We MUST trigger input to notify any listeners (like PathSuggest or internal state)
            this.searchInputEl.dispatchEvent(new Event('input'));
        }
        this.renderView();
    }, this));
    // @ts-ignore - Custom event not in Obsidian types
    this.registerEvent(this.app.workspace.on("abstract-folder:expand-all", () => this.expandAll(), this));
    // @ts-ignore - Custom event not in Obsidian types
    this.registerEvent(this.app.workspace.on("abstract-folder:collapse-all", () => this.collapseAll(), this));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
        if (file) this.metricsManager.onInteraction(file.path);
        this.fileRevealManager?.onFileOpen(file);
    }));
  }

  private registerConversionEvents() {
    // @ts-ignore - Custom event not in Obsidian types
    this.registerEvent(this.app.workspace.on("abstract-folder:conversion-start", (data: { total: number, message: string }) => {
        this.isConverting = true;
        this.conversionStatus = { processed: 0, total: data.total || 0, message: data.message || "Starting conversion..." };
        this.contentEl.empty();
        this.renderConversionProgress(); 
    }));
    // @ts-ignore - Custom event not in Obsidian types
    this.registerEvent(this.app.workspace.on("abstract-folder:conversion-progress", (data: { processed: number, total: number, message: string }) => {
        if (this.isConverting) {
            this.conversionStatus = { processed: data.processed, total: data.total, message: data.message };
            this.renderConversionProgress();
        }
    }));
    // @ts-ignore - Custom event not in Obsidian types
    this.registerEvent(this.app.workspace.on("abstract-folder:conversion-complete", () => {
        this.isConverting = false;
        this.renderView();
    }));
  }

  private registerDomEvents() {
    this.contentEl.addEventListener("contextmenu", (event: MouseEvent) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        this.contextMenuHandler.showBackgroundMenu(event);
    });
    
    this.contentEl.addEventListener("dragover", (e) => this.dragManager.handleDragOver(e, null));
    this.contentEl.addEventListener("dragleave", (e) => this.dragManager.handleDragLeave(e));
    this.contentEl.addEventListener("drop", (e) => {
        this.dragManager.handleDrop(e, null).catch(Logger.error);
    });

    // Content scroll event is now secondary to virtual wrapper scroll
    this.contentEl.addEventListener("scroll", () => {
        if (this.settings.viewStyle === 'tree') {
            window.requestAnimationFrame(() => this.virtualTreeManager.updateRender());
        }
    });

    this.resizeObserver = new ResizeObserver(() => {
        if (this.settings.viewStyle === 'tree') {
            window.requestAnimationFrame(() => this.virtualTreeManager.updateRender());
        }
    });
    this.resizeObserver.observe(this.contentEl);

    // Watch for scroll events on the virtual wrapper
    const virtualWrapper = this.contentEl.querySelector(".abstract-folder-virtual-wrapper");
    if (virtualWrapper) {
        virtualWrapper.addEventListener("scroll", () => {
            if (this.settings.viewStyle === 'tree') {
                window.requestAnimationFrame(() => this.virtualTreeManager.updateRender());
            }
        });
    }

    // Previous manual DOM event listeners for keyboard navigation have been removed 
    // in favor of the registerScopeHotkeys method which uses Obsidian's key scope system.
  }

  private registerScopeHotkeys() {
    if (!this.scope) return;

    // Navigation Up
    this.scope.register([], "ArrowUp", (event) => {
        event.preventDefault();
        this.handleArrowNavigation(-1);
        return false;
    });

    // Navigation Down
    this.scope.register([], "ArrowDown", (event) => {
        event.preventDefault();
        this.handleArrowNavigation(1);
        return false;
    });

    // Open in current tab
    this.scope.register([], "Enter", (event) => {
        event.preventDefault();
        this.handleEnterKey(false);
        return false;
    });

  }

    // Handles Enter key to open files or toggle folders
    public handleEnterKey(newTab: boolean) {
        const selectedEl = this.contentEl.querySelector(".is-active");
      if (!selectedEl) return;
      
      const itemEl = selectedEl.closest(".abstract-folder-item") as ExtendedHTMLElement;
      const path = itemEl?.getAttribute("data-path");
      const contextId = itemEl?._contextId;

      if (path) {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) {
              if (newTab) {
                  this.app.workspace.getLeaf('tab').openFile(file).catch(Logger.error);
              } else {
                  this.app.workspace.getLeaf(false).openFile(file).catch(Logger.error);
              }
          } else if (!newTab) {
              // Enter on folder -> Toggle collapse
               const folderNode = this.indexer.getGraph().parentToChildren[path];
               if (folderNode || this.indexer.getGraph().allFiles.has(path)) {
                   this.toggleCollapse(itemEl || null as unknown as HTMLElement, path, contextId).catch(Logger.error);
               }
          }
      }
  }

    // Handles visual-only keyboard selection in the tree view
    public handleArrowNavigation(direction: number) {
        if (this.settings.viewStyle !== 'tree') return; // Only for tree view for now

      const allItems = Array.from(this.contentEl.querySelectorAll('.abstract-folder-item-self'));
      if (allItems.length === 0) return;

      const currentIndex = allItems.findIndex(el => el.hasClass('is-active'));
      let nextIndex = currentIndex + direction;

      // Wrap around? Or stop at edges? Standard is stop at edges.
      if (nextIndex < 0) nextIndex = 0;
      if (nextIndex >= allItems.length) nextIndex = allItems.length - 1;

      if (nextIndex !== currentIndex) {
          allItems.forEach(el => el.removeClass('is-active'));
          
          const nextEl = allItems[nextIndex] as HTMLElement;
          nextEl.addClass('is-active');

          nextEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else if (currentIndex === -1 && allItems.length > 0) {
          // Select first item if none selected
           const firstEl = allItems[0] as HTMLElement;
           firstEl.addClass('is-active');
           firstEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
  }

  public onClose = () => {
    if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = undefined;
    }
    return Promise.resolve();
  }

  private handleViewStyleChanged = () => {
    this.toolbar.updateViewStyleToggleButton();
    this.toolbar.updateButtonStates();
    this.renderView();
  }

  private renderView = () => {
    this.contentEl.removeClass("abstract-folder-columns-wrapper");
    this.contentEl.removeClass("abstract-folder-tree-wrapper");

    const children = Array.from(this.contentEl.children);
    children.forEach(child => {
        if (!child.hasClass("abstract-folder-virtual-wrapper") &&
            !child.hasClass("abstract-folder-header-title") &&
            !child.hasClass("abstract-folder-search-header") &&
            !child.hasClass("abstract-folder-header-wrapper") &&
            !child.hasClass("abstract-folder-toolbar-container")) {
            child.remove();
        }
    });

    this.ensureVirtualContainers();
    this.toolbar?.setupToolbarActions();
    this.renderHeader();
    this.renderSearchHeader();

    if (this.isLoading && this.indexer.getGraph().allFiles.size === 0) {
        this.hideVirtualContainers();
        this.contentEl.createEl("div", { cls: "abstract-folder-loading-state", text: "Loading abstract graph..." });
        return;
    }

    if (this.isConverting) {
        this.hideVirtualContainers();
        this.renderConversionProgress();
        return;
    }

    if (this.settings.viewStyle === 'tree') {
        this.contentEl.addClass("abstract-folder-tree-wrapper");
        this.showVirtualContainers();
        void this.renderVirtualTreeView();
    } else {
        this.contentEl.addClass("abstract-folder-columns-wrapper");
        this.hideVirtualContainers();
        this.virtualTreeManager.clear();
        this.renderColumnView();
    }
  };

  private ensureVirtualContainers() {
    let virtualWrapper = this.contentEl.querySelector(".abstract-folder-virtual-wrapper") as HTMLElement;
    if (!virtualWrapper) {
        virtualWrapper = this.contentEl.createDiv({ cls: "abstract-folder-virtual-wrapper" });
        this.virtualSpacer = virtualWrapper.createDiv({ cls: "abstract-folder-virtual-spacer" });
        this.virtualContainer = virtualWrapper.createDiv({ cls: "abstract-folder-virtual-container" });
        this.virtualTreeManager?.clear();
    } else {
        this.virtualSpacer = virtualWrapper.querySelector(".abstract-folder-virtual-spacer");
        this.virtualContainer = virtualWrapper.querySelector(".abstract-folder-virtual-container");
    }
  }

  private renderSearchHeader() {
    let searchHeader = this.contentEl.querySelector(".abstract-folder-search-header") as HTMLElement;
    
    if (this.settings.viewStyle !== 'tree' || !this.settings.showSearchHeader) {
        if (searchHeader) searchHeader.remove();
        this.searchHeaderEl = null;
        this.searchInputEl = null;
        return;
    }

    if (!searchHeader) {
        searchHeader = document.createElement("div");
        searchHeader.addClass("abstract-folder-search-header");
        
        // Ensure proper order for sticky positioning: Toolbar -> Search -> Group Title
        const toolbarContainer = this.contentEl.querySelector(".abstract-folder-toolbar-container");
        const headerTitle = this.contentEl.querySelector(".abstract-folder-header-title");
        
        if (headerTitle) headerTitle.before(searchHeader);
        else if (toolbarContainer) toolbarContainer.after(searchHeader);
        else this.contentEl.prepend(searchHeader);

        const searchContainer = searchHeader.createDiv({ cls: "ancestry-search-container" });
        const searchIconEl = searchContainer.createDiv({ cls: "ancestry-search-icon" });
        setIcon(searchIconEl, "search");

        this.searchInputEl = searchContainer.createEl("input", {
            type: "text",
            placeholder: "Search file context...",
            cls: "ancestry-search-input"
        });

        const showParentsBtn = searchContainer.createDiv({
            cls: "clickable-icon ancestry-search-toggle",
            attr: { "aria-label": "Show parents in search", "title": "Show parents in search" }
        });
        setIcon(showParentsBtn, "arrow-up-left");
        if (this.settings.searchShowParents) showParentsBtn.addClass("is-active");

        showParentsBtn.addEventListener("click", () => {
            void (async () => {
                this.settings.searchShowParents = !this.settings.searchShowParents;
                showParentsBtn.toggleClass("is-active", this.settings.searchShowParents);
                await this.plugin.saveSettings();
                
                // Only re-trigger render of the view, NOT the input event which triggers suggestions
                if (this.searchInputEl && this.searchInputEl.value.trim().length > 0) {
                     this.renderView();
                }
            })();
        });

        const showChildrenBtn = searchContainer.createDiv({
            cls: "clickable-icon ancestry-search-toggle",
            attr: { "aria-label": "Show children in search", "title": "Show children in search" }
        });
        setIcon(showChildrenBtn, "arrow-down-right");
        if (this.settings.searchShowChildren) showChildrenBtn.addClass("is-active");

        showChildrenBtn.addEventListener("click", () => {
            void (async () => {
                this.settings.searchShowChildren = !this.settings.searchShowChildren;
                showChildrenBtn.toggleClass("is-active", this.settings.searchShowChildren);
                await this.plugin.saveSettings();

                // Only re-trigger render of the view, NOT the input event which triggers suggestions
                if (this.searchInputEl && this.searchInputEl.value.trim().length > 0) {
                     this.renderView();
                }
            })();
        });

        const clearIconEl = searchContainer.createDiv({ cls: "ancestry-search-clear-icon is-visible" });
        setIcon(clearIconEl, "x");
        clearIconEl.addEventListener("click", () => {
             if (this.searchInputEl) {
                 this.searchInputEl.value = "";
                 // When search is cleared, if a group was activated while searching,
                 // we should also clear that group to avoid it popping up unexpectedly.
                 if (this.settings.activeGroupId) {
                     this.clearActiveGroup(false);
                 }
                 this.searchInputEl.trigger("input");
                 this.searchInputEl.focus();
                 this.renderView(); // Trigger view update immediately
             }
        });

        new PathSuggest(this.app, this.searchInputEl, this.indexer, this.settings);

        this.searchInputEl.addEventListener("input", () => {
            // If user starts typing, we MUST clear active group to prevent "illegal" state
            // where search results are mixed with group constraints or group title is shown incorrectly
            if (this.searchInputEl && this.searchInputEl.value.trim().length > 0 && this.settings.activeGroupId) {
                // We set to null directly to avoid triggering group-changed event which would clear search again
                this.settings.activeGroupId = null;
                void this.plugin.saveSettings();
                // We don't trigger event because we are about to renderView anyway
            }
            // clearIconEl is always visible now
            this.renderView();
            this.searchInputEl?.focus();
        });
        
        // Add specific class for targeting the suggestion container
        if (this.searchInputEl) {
             // We can't access the suggest container directly from here easily as it's created by AbstractInputSuggest
             // internally and appended to document.body.
             // However, PathSuggest can be modified to add a specific class to its container or we rely on CSS
             // that targets the suggestion container relative to the focused input if possible, 
             // but Obsidian's suggestion container is usually absolutely positioned at body level.
             
             // The workaround is that PathSuggest implementation now exposes a way to add class or we handle it in PathSuggest itself.
             // Since we modified PathSuggest to add 'abstract-folder-suggestion-container', we can now style it in global styles.
        }
        
        this.searchHeaderEl = searchHeader;
    } else {
        this.searchHeaderEl = searchHeader;
        this.searchInputEl = searchHeader.querySelector(".ancestry-search-input") as HTMLInputElement;
        
        // Re-inject PathSuggest if it's not active (though PathSuggest usually stays)
        // But importantly, ensure it's before any existing title
        const headerTitle = this.contentEl.querySelector(".abstract-folder-header-title");
        if (headerTitle && headerTitle.previousSibling !== searchHeader) {
            headerTitle.before(searchHeader);
        }
    }
  }

  private renderHeader() {
    let headerEl = this.contentEl.querySelector(".abstract-folder-header-title") as HTMLElement;
    
    const activeGroup = this.settings.activeGroupId
        ? this.settings.groups.find(group => group.id === this.settings.activeGroupId)
        : null;
    const headerText = activeGroup ? activeGroup.name : "";

    if (headerText) {
        if (!headerEl) {
            headerEl = document.createElement("div");
            headerEl.textContent = headerText;
            headerEl.addClass("abstract-folder-header-title");
            const searchHeader = this.contentEl.querySelector(".abstract-folder-search-header");
            const toolbarContainer = this.contentEl.querySelector(".abstract-folder-toolbar-container");
            
            if (searchHeader) searchHeader.after(headerEl);
            else if (toolbarContainer) toolbarContainer.after(headerEl);
            else this.contentEl.prepend(headerEl);
        } else {
             headerEl.textContent = headerText;
        }
    } else if (headerEl) {
        headerEl.remove();
    }
  }

  private hideVirtualContainers() {
    if (this.virtualContainer) this.virtualContainer.toggleClass('abstract-folder-hidden', true);
    if (this.virtualSpacer) this.virtualSpacer.toggleClass('abstract-folder-hidden', true);
  }

  private showVirtualContainers() {
    if (this.virtualContainer) this.virtualContainer.toggleClass('abstract-folder-hidden', false);
    if (this.virtualSpacer) this.virtualSpacer.toggleClass('abstract-folder-hidden', false);
  }

  private renderConversionProgress = () => {
    const existingProgress = this.contentEl.querySelector('.abstract-folder-conversion-progress');
    let container = existingProgress as HTMLElement;
    
    if (!container) {
        container = this.contentEl.createDiv({ cls: 'abstract-folder-conversion-progress' });
        container.createDiv({ cls: 'conversion-title', text: 'Converting Folder Structure...' });
        container.createDiv({ cls: 'conversion-message' });
        const progressBarContainer = container.createDiv({ cls: 'conversion-progress-bar-container' });
        progressBarContainer.createDiv({ cls: 'conversion-progress-bar-fill' });
        container.createDiv({ cls: 'conversion-stats' });
    }

    const messageEl = container.querySelector('.conversion-message');
    const fillEl = container.querySelector('.conversion-progress-bar-fill') as HTMLElement;
    const statsEl = container.querySelector('.conversion-stats');

    if (messageEl) messageEl.textContent = this.conversionStatus.message;
    if (fillEl && this.conversionStatus.total > 0) {
        const percentage = Math.min(100, Math.round((this.conversionStatus.processed / this.conversionStatus.total) * 100));
        fillEl.style.width = `${percentage}%`;
    }
    if (statsEl) statsEl.textContent = `${this.conversionStatus.processed} / ${this.conversionStatus.total} operations`;
  }

    private renderVirtualTreeView = async () => {
    if (this.settings.viewStyle === 'tree' && this.searchInputEl && this.searchInputEl.value.trim().length > 0) {
        const query = this.searchInputEl.value.trim();
        const searchFn = prepareSimpleSearch(query);
        
        // Add searching class to container
        this.contentEl.addClass("abstract-folder-is-searching");

        // Clear any previous highlighting first
        this.virtualTreeManager.setHighlightedPath(null);
        this.treeRenderer.setHighlightedPath(null);

        const graph = this.indexer.getGraph();
        const allowedPaths = new Set<string>();
        const forceExpand = new Set<string>();
        const matchedPaths: string[] = [];

        // 1. Find matches using Obsidian's simple search
        const allFiles = this.app.vault.getFiles();
        for (const file of allFiles) {
            const filePath = file.path;
            
            let matches = !!searchFn(filePath);
            
            if (!matches) {
                const cache = this.app.metadataCache.getFileCache(file);
                // 1. Check aliases from frontmatter
                const aliases = cache?.frontmatter?.aliases as unknown;
                if (Array.isArray(aliases)) {
                    matches = aliases.some(alias => !!searchFn(String(alias)));
                } else if (typeof aliases === 'string') {
                    matches = !!searchFn(aliases);
                }

                // 2. Check title (from frontmatter if exists)
                const title = cache?.frontmatter?.title as unknown;
                if (!matches && typeof title === 'string') {
                    matches = !!searchFn(title);
                }

                // 3. Fallback: check all metadata keys for potential match (properties)
                if (!matches && cache?.frontmatter) {
                    for (const key in cache.frontmatter) {
                        if (key === 'position') continue;
                        const val = cache.frontmatter[key] as unknown;
                        if (typeof val === 'string' && !!searchFn(val)) {
                            matches = true;
                            break;
                        }
                    }
                }
            }

            if (matches) {
                matchedPaths.push(filePath);
                allowedPaths.add(filePath);
            }
        }

        if (matchedPaths.length > 0) {
            const ancestryEngine = new AncestryEngine(this.indexer);
            
            // 2. Process parents and children for matches
            for (const matchedPath of matchedPaths) {
                // Always calculate ancestry to ensure we can force expand parents
                const allAncestors = ancestryEngine.getAncestryNodePaths(matchedPath);
                allAncestors.forEach(p => forceExpand.add(p));
                
                if (this.settings.searchShowParents) {
                    allAncestors.forEach(p => allowedPaths.add(p));
                }

                // Include children if enabled
                if (this.settings.searchShowChildren) {
                    const stack = [matchedPath];
                    const visited = new Set<string>();
                    while (stack.length > 0) {
                        const current = stack.pop()!;
                        if (visited.has(current)) continue;
                        visited.add(current);
                        
                        allowedPaths.add(current);
                        forceExpand.add(current);
                        
                        const children = graph.parentToChildren[current];
                        if (children) {
                            children.forEach(childPath => stack.push(childPath));
                        }
                    }
                }
            }

            // Highlight the first direct match if query matches perfectly or just first match
            const exactMatch = matchedPaths.find(p => p.toLowerCase().includes(query));
            if (exactMatch) {
                this.virtualTreeManager.setHighlightedPath(exactMatch);
                this.treeRenderer.setHighlightedPath(exactMatch);
            }

            await this.virtualTreeManager.generateItems(allowedPaths, forceExpand, true);
        } else {
            // No matches found
            await this.virtualTreeManager.generateItems(new Set(), new Set(), true);
        }
    } else {
        // Normal render
        this.contentEl.removeClass("abstract-folder-is-searching");
        this.virtualTreeManager.setHighlightedPath(null);
        this.treeRenderer.setHighlightedPath(null);
        await this.virtualTreeManager.generateItems();
    }

    if (this.virtualTreeManager.getFlatItems().length === 0) {
        this.hideVirtualContainers();
        this.contentEl.createEl("div", {
            text: "No abstract folders found. Add parent property to your notes to create a structure.",
            cls: "abstract-folder-empty-state"
        });
        return;
    }

    this.virtualTreeManager.clear();
    this.virtualTreeManager.updateRender();
    Logger.debug("AbstractFolderView: renderVirtualTreeView complete", {
        flatItemsCount: this.virtualTreeManager.getFlatItems().length,
        expandedFoldersCount: this.settings.expandedFolders.length
    });
   }

  private renderColumnView = () => {
    // If we are in column view and a group is active, we should ensure search is empty
    // (though search is currently only visible in tree view, this is good for consistency)
    
    const rootNodes = buildFolderTree(this.app, this.indexer.getGraph(), (a, b) => this.sortNodes(a, b), this.viewState.excludeExtensions);
    
    rootNodes.sort((a, b) => {
        const aHasChildren = a.children.length > 0;
        const bHasChildren = b.children.length > 0;
        if (aHasChildren && !bHasChildren) return -1;
        if (!aHasChildren && bHasChildren) return 1;
        return this.sortNodes(a, b);
    });

    let finalRootNodes = rootNodes;
    if (this.settings.activeGroupId) {
      const activeGroup = this.settings.groups.find(group => group.id === this.settings.activeGroupId);
      if (activeGroup) finalRootNodes = this.filterNodesByGroup(rootNodes, activeGroup);
    }

    if (finalRootNodes.length === 0) {
      this.contentEl.createEl("div", {
        text: "No abstract folders found. Add parent property to your notes to create a structure.",
        cls: "abstract-folder-empty-state"
      });
      return;
    }

    const columnsContainer = document.createElement("div");
    columnsContainer.addClass("abstract-folder-columns-container");

    let currentNodes: FolderNode[] = finalRootNodes;
    let renderedDepth = 0;

    this.columnRenderer.renderColumn(currentNodes, columnsContainer, renderedDepth);

    for (let i = 0; i < this.viewState.selectionPath.length; i++) {
      const selectedPath = this.viewState.selectionPath[i];
      const selectedNode = currentNodes.find(node => node.path === selectedPath);
      if (!selectedNode) break;

      if (selectedNode && selectedNode.isFolder && selectedNode.children.length > 0) {
        currentNodes = selectedNode.children;
        renderedDepth++;
        this.columnRenderer.renderColumn(currentNodes, columnsContainer, renderedDepth, selectedPath);
      } else break;
    }
    this.contentEl.appendChild(columnsContainer);
  };

  private sortNodes(a: FolderNode, b: FolderNode): number {
    return createSortComparator(
        this.app,
        this.settings,
        this.viewState.sortBy,
        this.viewState.sortOrder,
        this.metricsManager
    )(a, b);
  }

  private expandAll = async () => {
    Logger.debug("AbstractFolderView: expandAll called");
    if (this.settings.viewStyle === 'tree') {
      const graph = this.indexer.getGraph();
      const allContextualIds: string[] = [];
      
      const traverseAll = (currentPath: string, parentPath: string | null) => {
          const cid = `${parentPath || "root"} > ${currentPath}`;
          const children = graph.parentToChildren[currentPath];
          
          if (children && children.size > 0) {
              allContextualIds.push(cid);
              for (const childPath of children) {
                  traverseAll(childPath, currentPath);
              }
          }
      };

      let rootPaths: string[] = [];
      if (this.settings.activeGroupId) {
          const activeGroup = this.settings.groups.find(g => g.id === this.settings.activeGroupId);
          if (activeGroup) {
              rootPaths = activeGroup.parentFolders.map(p => this.app.vault.getAbstractFileByPath(p)?.path).filter(Boolean) as string[];
          }
      }
      
      if (rootPaths.length === 0) {
          rootPaths = Array.from(graph.roots);
      }

      for (const rootPath of rootPaths) {
          traverseAll(rootPath, null);
      }

      Logger.debug(`AbstractFolderView: expandAll generated ${allContextualIds.length} CIDs for ${this.settings.activeGroupId ? 'group' : 'global'} view`);
      this.settings.expandedFolders = allContextualIds;
      
      if (this.settings.rememberExpanded) {
        Logger.debug("AbstractFolderView: saving settings for expandAll");
        await this.plugin.saveSettings();
      }
      this.renderView();
    } else {
        Logger.debug("AbstractFolderView: expandAll ignored because viewStyle is not tree", this.settings.viewStyle);
    }
  }

  private collapseAll = async () => {
    Logger.debug("AbstractFolderView: collapseAll called");
    if (this.settings.viewStyle === 'tree') {
      this.settings.expandedFolders = [];
      if (this.settings.rememberExpanded) {
        Logger.debug("AbstractFolderView: saving settings for collapseAll");
        await this.plugin.saveSettings();
      }
      this.renderView();
    } else {
        Logger.debug("AbstractFolderView: collapseAll ignored because viewStyle is not tree", this.settings.viewStyle);
    }
  }

  public async expandFolderByPath(folderPath: string, contextId?: string) {
    const selector = contextId ? `[data-context-id="${contextId}"]` : `[data-path="${folderPath}"]`;
    const folderEl = this.contentEl.querySelector(selector);
    const effectiveId = contextId || (folderEl as ExtendedHTMLElement)?._contextId || folderPath;

    if (folderEl && folderEl.hasClass("is-collapsed")) {
      folderEl.removeClass("is-collapsed");
      if (this.settings.rememberExpanded && !this.settings.expandedFolders.includes(effectiveId)) {
        this.settings.expandedFolders.push(effectiveId);
        await this.plugin.saveSettings();
      }
    }
  }

  private async toggleCollapse(itemEl: HTMLElement, path: string, contextId?: string) {
    const effectiveId = contextId || (itemEl as ExtendedHTMLElement)?._contextId || path;
    const expanded = this.settings.expandedFolders.includes(effectiveId);
    if (expanded) this.settings.expandedFolders = this.settings.expandedFolders.filter(p => p !== effectiveId);
    else this.settings.expandedFolders.push(effectiveId);
    
    if (this.settings.rememberExpanded) await this.plugin.saveSettings();
    this.renderView();
  }

  private toggleSearch() {
    this.isSearchVisible = !this.isSearchVisible;
    if (!this.isSearchVisible && this.searchInputEl) {
        this.searchInputEl.value = "";
    }
    this.renderView();
    if (this.isSearchVisible && this.searchInputEl) {
        this.searchInputEl.focus();
    }
  }

  public focusSearch() {
    if (this.settings.viewStyle !== 'tree') {
      this.viewState.toggleViewStyle();
    }
    
    // Ensure search input exists (it's created during render if in tree view)
    if (!this.searchInputEl) {
        this.renderView();
    }

    if (this.searchInputEl) {
        this.searchInputEl.focus();
        this.searchInputEl.select();
    }
  }

  public focusFile(path: string) {
    if (this.settings.viewStyle !== 'tree') {
      this.viewState.toggleViewStyle();
    }

    if (this.searchInputEl) {
      if (this.searchInputEl.value === path) {
        // Toggle off if already focused
        this.searchInputEl.value = "";
        this.renderView();
      } else {
        // Focus new file
        this.searchInputEl.value = path;
        this.renderView();
        // Ensure it's scrolled into view and highlighted
        this.fileRevealManager?.revealFile(path);
      }
    }
  }

  public focusActiveFile() {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      this.focusFile(activeFile.path);
    }
  }

  public clearActiveGroup(showNotice: boolean = true) {
    if (this.settings.activeGroupId) {
        this.settings.activeGroupId = null;
        this.plugin.saveSettings().then(() => {
            if (showNotice) new Notice("Active group cleared.");
            this.app.workspace.trigger('abstract-folder:group-changed');
        }).catch(Logger.error);
    } else if (showNotice) {
        new Notice("No active group to clear.");
    }
  }

  private getDisplayName = (node: FolderNode): string => {
    if (node.path === HIDDEN_FOLDER_ID) return "Hidden";
    if (node.file instanceof TFile) {
      const cache = this.app.metadataCache.getFileCache(node.file);
      const frontmatter = cache?.frontmatter;

      for (const priority of this.settings.displayNameOrder) {
        if (priority === 'basename') {
          return node.file.basename;
        }

        if (priority === 'aliases') {
          if (!this.settings.showAliases) continue;
          const aliases = frontmatter?.aliases as string | string[] | undefined;
          if (Array.isArray(aliases) && aliases.length > 0) return String(aliases[0]);
          else if (typeof aliases === 'string') return aliases;
          continue;
        }

        // Custom property check (e.g., 'title')
        if (frontmatter && frontmatter[priority]) {
          const value = frontmatter[priority] as unknown;
          if (typeof value === 'string' && value.trim().length > 0) {
            return value;
          }
        }
      }

      return node.file.basename; // Final fallback
    }
    return node.path.split('/').pop() || node.path;
  }

  private handleColumnNodeClick = (node: FolderNode, depth: number, event?: MouseEvent) => {
    const isMultiSelectModifier = event && (event.altKey || event.ctrlKey || event.metaKey);
    if (isMultiSelectModifier) {
      if (this.viewState.multiSelectedPaths.size === 0) {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) this.viewState.toggleMultiSelect(activeFile.path);
      }
      this.viewState.toggleMultiSelect(node.path);
      return;
    }

    this.viewState.clearMultiSelection();
    if (node.file instanceof TFile) {
      const fileExists = this.app.vault.getAbstractFileByPath(node.file.path);
      if (fileExists instanceof TFile) this.app.workspace.getLeaf(false).openFile(fileExists).catch(Logger.error);
    }

    if (node.isFolder || node.file) {
      const currentColumnPath = this.viewState.selectionPath.slice(0, depth);
      const newSelectionPath = [...currentColumnPath, node.path];
      this.viewState.selectionPath = newSelectionPath;
      this.columnRenderer.setSelectionPath(this.viewState.selectionPath);
      this.renderView();
    }
  }

  private handleColumnExpand = (node: FolderNode, depth: number) => {
    if (node.isFolder || node.file) {
      const currentColumnPath = this.viewState.selectionPath.slice(0, depth);
      const newSelectionPath = [...currentColumnPath, node.path];
      this.viewState.selectionPath = newSelectionPath;
      this.columnRenderer.setSelectionPath(this.viewState.selectionPath);
      this.renderView();
    }
  }

  private filterNodesByGroup(nodes: FolderNode[], activeGroup: Group): FolderNode[] {
    const finalFilteredRoots: FolderNode[] = [];
    const explicitlyIncludedPaths = new Set(activeGroup.parentFolders.map(path => this.app.vault.getAbstractFileByPath(path)?.path).filter(Boolean) as string[]);
    const allNodesMap = new Map<string, FolderNode>();
    const buildNodeMap = (currentNodes: FolderNode[]) => {
        for (const node of currentNodes) {
            allNodesMap.set(node.path, node);
            buildNodeMap(node.children);
        }
    };
    buildNodeMap(nodes);

    const deepCopyNode = (node: FolderNode): FolderNode => ({ ...node, children: node.children.map(deepCopyNode) });

    for (const includedPath of explicitlyIncludedPaths) {
        let matchingNode = allNodesMap.get(includedPath);
        if (!matchingNode) {
             const folderName = includedPath.split('/').pop();
             if (folderName) matchingNode = allNodesMap.get(`${includedPath}/${folderName}.md`);
        }
        if (!matchingNode && !includedPath.endsWith('.md')) matchingNode = allNodesMap.get(`${includedPath}.md`);
        if (matchingNode) finalFilteredRoots.push(deepCopyNode(matchingNode));
    }
    finalFilteredRoots.sort((a, b) => this.sortNodes(a, b));
    return finalFilteredRoots;
  }
}
