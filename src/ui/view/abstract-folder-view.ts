import { ItemView, WorkspaceLeaf, setIcon, TFile } from "obsidian";
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

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

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
      (itemEl, path) => this.toggleCollapse(itemEl, path),
      this.indexer, this.dragManager
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

    this.contextMenuHandler = new ContextMenuHandler(this.app, this.settings, this.plugin, this.indexer);
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
       () => {} // Callback for search toggle (deprecated but kept for compat)
    );

    const virtualWrapper = this.contentEl.createDiv({ cls: "abstract-folder-virtual-wrapper" });
    this.virtualSpacer = virtualWrapper.createDiv({ cls: "abstract-folder-virtual-spacer" });
    this.virtualContainer = virtualWrapper.createDiv({ cls: "abstract-folder-virtual-container" });
    
    this.virtualSpacer.toggleClass('abstract-folder-hidden', true);
    this.virtualContainer.toggleClass('abstract-folder-hidden', true);

    this.virtualTreeManager = new VirtualTreeManager(
        this.app, this.settings, this.indexer, this.viewState, this.treeRenderer,
        this.contentEl, this.virtualSpacer, this.virtualContainer, (a, b) => this.sortNodes(a, b)
    );

    await Promise.resolve();
    this.fileRevealManager = new FileRevealManager(
        this.app, this.settings, this.contentEl, this.viewState, this.indexer,
        this.columnRenderer, () => this.renderView(), this.plugin
    );

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
    // @ts-ignore
    this.registerEvent(this.app.workspace.on("abstract-folder:graph-updated", () => {
        if (this.isConverting) return;
        this.isLoading = false;
        this.metricsManager.calculateGraphMetrics();
        this.renderView();
    }));
    // @ts-ignore
    this.registerEvent(this.app.workspace.on("abstract-folder:graph-build-start", () => {
        this.isLoading = true;
        this.renderView();
    }));
    // @ts-ignore
    this.registerEvent(this.app.workspace.on("abstract-folder:view-style-changed", this.handleViewStyleChanged, this));
    // @ts-ignore
    this.registerEvent(this.app.workspace.on("abstract-folder:group-changed", this.renderView, this));
    // @ts-ignore
    this.registerEvent(this.app.workspace.on("abstract-folder:expand-all", () => this.expandAll(), this));
    // @ts-ignore
    this.registerEvent(this.app.workspace.on("abstract-folder:collapse-all", () => this.collapseAll(), this));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
        if (file) this.metricsManager.onInteraction(file.path);
        this.fileRevealManager?.onFileOpen(file);
    }));
  }

  private registerConversionEvents() {
    // @ts-ignore
    this.registerEvent(this.app.workspace.on("abstract-folder:conversion-start", (data: { total: number, message: string }) => {
        this.isConverting = true;
        this.conversionStatus = { processed: 0, total: data.total || 0, message: data.message || "Starting conversion..." };
        this.contentEl.empty();
        this.renderConversionProgress(); 
    }));
    // @ts-ignore
    this.registerEvent(this.app.workspace.on("abstract-folder:conversion-progress", (data: { processed: number, total: number, message: string }) => {
        if (this.isConverting) {
            this.conversionStatus = { processed: data.processed, total: data.total, message: data.message };
            this.renderConversionProgress();
        }
    }));
    // @ts-ignore
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
        this.dragManager.handleDrop(e, null).catch(console.error);
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

  public handleEnterKey(newTab: boolean) {
      const selectedEl = this.contentEl.querySelector(".is-active");
      if (!selectedEl) return;
      
      const itemEl = selectedEl.closest(".abstract-folder-item") as HTMLElement;
      const path = itemEl?.getAttribute("data-path");

      if (path) {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) {
              if (newTab) {
                  // Open in new tab (true = split leaf)
                  this.app.workspace.getLeaf('tab').openFile(file).catch(console.error);
              } else {
                  // Open in current tab
                  this.app.workspace.getLeaf(false).openFile(file).catch(console.error);
              }
          } else if (!newTab) {
              // Enter on folder -> Toggle collapse
               const folderNode = this.indexer.getGraph().parentToChildren[path];
               if (folderNode || this.indexer.getGraph().allFiles.has(path)) {
                   this.toggleCollapse(null as unknown as HTMLElement, path).catch(console.error);
               }
          }
      }
  }

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
          // Remove active class from all
          allItems.forEach(el => el.removeClass('is-active'));
          
          // Add to new
          const nextEl = allItems[nextIndex] as HTMLElement;
          nextEl.addClass('is-active');

          // Scroll into view if needed
          nextEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });

          // Update selection path for metrics/state if needed
          // But purely visual navigation is often enough for keyboard until selection
          
          // Optional: Trigger click or selection update?
          // Usually in file explorers, arrow keys change selection but don't "open" the file
          // We need to sync with "is-active" logic used elsewhere.
          const itemEl = nextEl.closest(".abstract-folder-item") as HTMLElement;
          const path = itemEl?.getAttribute("data-path");
          if (path) {
             // We manually update "is-active" visuals, but we should also reflect this as the "active" file in Obsidian?
             // Obsidian's file explorer does "preview" on selection if enabled. 
             // For now, let's just keep it as the highlighted item for keyboard operations.
          }
      } else if (currentIndex === -1 && allItems.length > 0) {
          // Select first item if none selected
           const firstEl = allItems[0] as HTMLElement;
           firstEl.addClass('is-active');
           firstEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
  }

  public onClose = async () => {
    if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = undefined;
    }
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
        this.renderVirtualTreeView();
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
    
    if (this.settings.viewStyle !== 'tree') {
        if (searchHeader) searchHeader.remove();
        this.searchHeaderEl = null;
        this.searchInputEl = null;
        return;
    }

    if (!searchHeader) {
        searchHeader = document.createElement("div");
        searchHeader.addClass("abstract-folder-search-header");
        
        // Ensure proper order for sticky positioning: Toolbar -> Group Title -> Search
        const toolbarContainer = this.contentEl.querySelector(".abstract-folder-toolbar-container");
        const headerTitle = this.contentEl.querySelector(".abstract-folder-header-title");
        
        if (headerTitle) headerTitle.after(searchHeader);
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
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            (async () => {
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
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            (async () => {
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
                 this.searchInputEl.trigger("input");
                 this.searchInputEl.focus();
                 this.renderView(); // Trigger view update immediately
             }
        });

        new PathSuggest(this.app, this.searchInputEl, this.indexer, this.settings);

        this.searchInputEl.addEventListener("input", () => {
            // clearIconEl is always visible now
            this.renderView();
            // @ts-ignore
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
        // But importantly, ensure it's after any existing title
        const headerTitle = this.contentEl.querySelector(".abstract-folder-header-title");
        if (headerTitle && headerTitle.nextSibling !== searchHeader) {
            headerTitle.after(searchHeader);
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
            const toolbarContainer = this.contentEl.querySelector(".abstract-folder-toolbar-container");
            if (toolbarContainer) toolbarContainer.after(headerEl);
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

  private renderVirtualTreeView = () => {
    if (this.settings.viewStyle === 'tree' && this.searchInputEl && this.searchInputEl.value.trim().length > 0) {
        const query = this.searchInputEl.value.trim();
        const file = this.app.vault.getAbstractFileByPath(query);
        if (file instanceof TFile) {
            // Start with just the file itself if we aren't showing parents
            let allowedPaths = new Set<string>();
            const forceExpand = new Set<string>();

            // Always calculate ancestry to ensure we can force expand parents
            // This fixes the bug where searching for a file in a collapsed folder showed nothing
            const allAncestors = new AncestryEngine(this.indexer).getAncestryNodePaths(file.path);
            allAncestors.forEach(p => forceExpand.add(p));
            
            if (this.settings.searchShowParents) {
                // If showing parents, use the full ancestry for visibility
                allowedPaths = allAncestors;
            } else {
                // Otherwise, just the file
                allowedPaths.add(file.path);
            }
            
             // Include children if the toggle is enabled
             if (this.settings.searchShowChildren) {
                 const children = this.indexer.getGraph().parentToChildren[file.path];
                 if (children) {
                     children.forEach(childPath => allowedPaths.add(childPath));
                 }
             }
            
            // We pass forceExpand to generateItems so it can generate items even if they are currently collapsed
            this.virtualTreeManager.generateItems(allowedPaths, forceExpand);
        } else {
             this.virtualTreeManager.generateItems();
        }
    } else {
        this.virtualTreeManager.generateItems();
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
   }

  private renderColumnView = () => {
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
    if (this.settings.viewStyle === 'tree') {
      const graph = this.indexer.getGraph();
      const allPaths = Object.keys(graph.parentToChildren);
      this.settings.expandedFolders = Array.from(allPaths);
      if (this.settings.rememberExpanded) await this.plugin.saveSettings();
      this.renderView();
    }
  }

  private collapseAll = async () => {
    if (this.settings.viewStyle === 'tree') {
      this.settings.expandedFolders = [];
      if (this.settings.rememberExpanded) await this.plugin.saveSettings();
      this.renderView();
    }
  }

  public async expandFolderByPath(folderPath: string) {
    const folderEl = this.contentEl.querySelector(`[data-path="${folderPath}"]`);
    if (folderEl && folderEl.hasClass("is-collapsed")) {
      folderEl.removeClass("is-collapsed");
      if (this.settings.rememberExpanded && !this.settings.expandedFolders.includes(folderPath)) {
        this.settings.expandedFolders.push(folderPath);
        await this.plugin.saveSettings();
      }
    }
  }

  private async toggleCollapse(itemEl: HTMLElement, path: string) {
    const expanded = this.settings.expandedFolders.includes(path);
    if (expanded) this.settings.expandedFolders = this.settings.expandedFolders.filter(p => p !== path);
    else this.settings.expandedFolders.push(path);
    
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

  private getDisplayName = (node: FolderNode): string => {
    if (node.path === HIDDEN_FOLDER_ID) return "Hidden";
    if (node.file) {
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
    if (node.file) {
      const fileExists = this.app.vault.getAbstractFileByPath(node.file.path);
      if (fileExists) this.app.workspace.getLeaf(false).openFile(node.file).catch(console.error);
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
