import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { FolderIndexer } from "../../indexer";
import { MetricsManager } from "../../metrics-manager";
import { FolderNode, HIDDEN_FOLDER_ID, Group } from "../../types";
import { AbstractFolderPluginSettings } from "../../settings";
import AbstractFolderPlugin from '../../../main';
import { TreeRenderer } from '../tree/tree-renderer';
import { ColumnRenderer } from '../column/column-renderer';
import { ViewState } from '../view-state';
import { buildFolderTree } from '../../utils/tree-utils';
import { ContextMenuHandler } from "../context-menu";
import { AbstractFolderViewToolbar } from "../toolbar/abstract-folder-view-toolbar";
import { FileRevealManager } from "../../file-reveal-manager";
import { DragManager } from "../dnd/drag-manager";
import { VirtualTreeManager } from "./virtual-tree-manager";

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
       () => this.renderView(), () => this.expandAll(), () => this.collapseAll(),
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
            !child.hasClass("abstract-folder-toolbar-container")) {
            child.remove();
        }
    });

    this.ensureVirtualContainers();
    this.renderHeader();

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

  private renderHeader() {
    let headerEl = this.contentEl.querySelector(".abstract-folder-header-title");
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
    this.virtualTreeManager.generateItems();

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
    let compareResult: number;
    if (this.viewState.sortBy === 'name') compareResult = a.path.localeCompare(b.path);
    else if (this.viewState.sortBy === 'mtime') {
      const fileA = a.file ? this.app.vault.getAbstractFileByPath(a.path) : null;
      const fileB = b.file ? this.app.vault.getAbstractFileByPath(b.path) : null;
      const mtimeA = (fileA instanceof TFile) ? fileA.stat.mtime : 0;
      const mtimeB = (fileB instanceof TFile) ? fileB.stat.mtime : 0;
      compareResult = mtimeA - mtimeB;
    } else if (this.viewState.sortBy === 'thermal') {
      compareResult = this.metricsManager.getMetrics(a.path).thermal - this.metricsManager.getMetrics(b.path).thermal;
    } else if (this.viewState.sortBy === 'rot') {
      compareResult = this.metricsManager.getMetrics(a.path).rot - this.metricsManager.getMetrics(b.path).rot;
    } else if (this.viewState.sortBy === 'gravity') {
      compareResult = this.metricsManager.getMetrics(a.path).gravity - this.metricsManager.getMetrics(b.path).gravity;
    } else compareResult = a.path.localeCompare(b.path);

    return this.viewState.sortOrder === 'asc' ? compareResult : -compareResult;
  }
  
  private expandAll = () => {
    if (this.settings.viewStyle === 'tree') {
      this.contentEl.querySelectorAll(".abstract-folder-item.is-collapsed").forEach(el => el.removeClass("is-collapsed"));
    }
  }

  private collapseAll = () => {
    if (this.settings.viewStyle === 'tree') {
      this.contentEl.querySelectorAll(".abstract-folder-item.is-folder:not(.is-collapsed)").forEach(el => el.addClass("is-collapsed"));
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

  private getDisplayName = (node: FolderNode): string => {
    if (node.path === HIDDEN_FOLDER_ID) return "Hidden";
    if (node.file) {
      if (this.settings.showAliases && node.file.extension === 'md') {
        const cache = this.app.metadataCache.getFileCache(node.file);
        const aliases = cache?.frontmatter?.aliases as string | string[] | undefined;
        if (Array.isArray(aliases) && aliases.length > 0) return String(aliases[0]);
        else if (typeof aliases === 'string') return aliases;
      }
      return node.file.basename;
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
