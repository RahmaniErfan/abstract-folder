import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { FolderIndexer } from "./indexer";
import { FolderNode, HIDDEN_FOLDER_ID, Group } from "./types";
import { AbstractFolderPluginSettings } from "./settings";
import AbstractFolderPlugin from '../main';
import { TreeRenderer } from './ui/tree/tree-renderer';
import { ColumnRenderer } from './ui/column/column-renderer';
import { ViewState } from './ui/view-state';
import { buildFolderTree } from './utils/tree-utils';
import { ContextMenuHandler } from "./ui/context-menu";
import { AbstractFolderViewToolbar } from "./ui/abstract-folder-view-toolbar";
import { FileRevealManager } from "./file-reveal-manager";
import { DragManager } from "./ui/dnd/drag-manager";

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

export class AbstractFolderView extends ItemView {
  private indexer: FolderIndexer;
  private settings: AbstractFolderPluginSettings;
  contentEl: HTMLElement;

  private viewState: ViewState;
  private treeRenderer: TreeRenderer;
  private columnRenderer: ColumnRenderer;
  private contextMenuHandler: ContextMenuHandler;
  private toolbar: AbstractFolderViewToolbar;
  private fileRevealManager: FileRevealManager | undefined;
  private dragManager: DragManager;

  constructor(
    leaf: WorkspaceLeaf,
    indexer: FolderIndexer,
    settings: AbstractFolderPluginSettings,
    private plugin: AbstractFolderPlugin
  ) {
    super(leaf);
    this.indexer = indexer;
    this.settings = settings;
    this.plugin = plugin;
    this.icon = "folder-tree";
    this.navigation = false;

    this.dragManager = new DragManager(this.app, this.settings, this.indexer, this);
    this.viewState = new ViewState(this.settings, this.plugin);
    this.treeRenderer = new TreeRenderer(
      this.app,
      this.settings,
      this.plugin,
      this.viewState.multiSelectedPaths,
      this.getDisplayName,
      (itemEl: HTMLElement, path: string) => this.toggleCollapse(itemEl, path),
      this.indexer,
      this.dragManager
    );
    this.columnRenderer = new ColumnRenderer(
      this.app,
      this.settings,
      this.plugin,
      this.viewState.selectionPath,
      this.viewState.multiSelectedPaths,
      this.getDisplayName,
      (node, depth, event) => this.handleColumnNodeClick(node, depth, event),
      this.indexer,
      this.dragManager
    );
    this.contextMenuHandler = new ContextMenuHandler(this.app, this.settings, this.plugin, this.indexer);
    this.toolbar = new AbstractFolderViewToolbar(
       this.app,
       this.settings,
       this.plugin,
       this.viewState,
       (icon, title, onclick) => this.addAction(icon, title, onclick),
       () => this.renderView(),
       () => this.expandAll(),
       () => this.collapseAll(),
    );
  }

  getViewType(): string {
    return VIEW_TYPE_ABSTRACT_FOLDER;
  }

  getDisplayText(): string {
    return "";
  }

  public onOpen = async () => {
    this.contentEl = this.containerEl.children[1] as HTMLElement;
    this.contentEl.empty();
    this.contentEl.addClass("abstract-folder-view");
    await Promise.resolve();
    this.fileRevealManager = new FileRevealManager(
        this.app,
        this.settings,
        this.contentEl,
        this.viewState,
        this.indexer,
        this.columnRenderer,
        () => this.renderView(),
        this.plugin
    );

    this.toolbar.setupToolbarActions();
    this.renderView();

    // @ts-ignore: Custom event name not in Obsidian types
    this.registerEvent(this.app.workspace.on("abstract-folder:graph-updated", this.renderView, this));
    // @ts-ignore: Custom event name not in Obsidian types
    this.registerEvent(this.app.workspace.on("abstract-folder:view-style-changed", this.handleViewStyleChanged, this));
    // @ts-ignore: Custom event name not in Obsidian types
    this.registerEvent(this.app.workspace.on("abstract-folder:group-changed", this.renderView, this));
    // Register events for expand/collapse all
    // @ts-ignore: Custom event name not in Obsidian types
    this.registerEvent(this.app.workspace.on("abstract-folder:expand-all", () => this.expandAll(), this));
    // @ts-ignore: Custom event name not in Obsidian types
    this.registerEvent(this.app.workspace.on("abstract-folder:collapse-all", () => this.collapseAll(), this));
    this.registerEvent(this.app.workspace.on("file-open", this.fileRevealManager.onFileOpen, this.fileRevealManager));
 
    this.contentEl.addEventListener("contextmenu", (event: MouseEvent) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        this.contextMenuHandler.showBackgroundMenu(event);
    });
    
    // Allow dropping into the root of the view
    this.contentEl.addEventListener("dragover", (e) => this.dragManager.handleDragOver(e, null));
    this.contentEl.addEventListener("dragleave", (e) => this.dragManager.handleDragLeave(e));
    this.contentEl.addEventListener("drop", (e) => {
        this.dragManager.handleDrop(e, null).catch(console.error);
    });
  }

  public onClose = async () => {
    // Cleanup is handled by registerEvent
  }

  private handleViewStyleChanged = () => {
    this.toolbar.updateViewStyleToggleButton();
    this.toolbar.updateButtonStates();
    this.renderView();
  }

  private renderView = () => {
    this.contentEl.empty();
    this.contentEl.removeClass("abstract-folder-columns-wrapper");
    this.contentEl.removeClass("abstract-folder-tree-wrapper");

    const activeGroup = this.settings.activeGroupId
        ? this.settings.groups.find(group => group.id === this.settings.activeGroupId)
        : null;
    const headerText = activeGroup ? activeGroup.name : "";
    if (headerText) {
        this.contentEl.createEl("div", {
            text: headerText,
            cls: "abstract-folder-header-title"
        });
    }

    if (this.settings.viewStyle === 'tree') {
        this.contentEl.addClass("abstract-folder-tree-wrapper");
        this.renderTreeView();
    } else {
        this.contentEl.addClass("abstract-folder-columns-wrapper");
        this.renderColumnView();
    }
  };

  private renderTreeView = () => {
    let rootNodes = buildFolderTree(this.app, this.indexer.getGraph(), (a, b) => this.sortNodes(a, b));

    if (this.settings.activeGroupId) {
        const activeGroup = this.settings.groups.find(group => group.id === this.settings.activeGroupId);
        if (activeGroup) {
            rootNodes = this.filterNodesByGroup(rootNodes, activeGroup);
        }
    }
 
     if (rootNodes.length === 0) {
       this.contentEl.createEl("div", {
           text: "No abstract folders found. Add parent property to your notes to create a structure.",
           cls: "abstract-folder-empty-state"
       });
       return;
     }
 
     const treeContainer = this.contentEl.createEl("div", { cls: "abstract-folder-tree" });
     rootNodes.forEach(node => {
       this.treeRenderer.renderTreeNode(node, treeContainer, new Set(), 0, null);
     });
 
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && this.fileRevealManager) {
        this.fileRevealManager.revealFile(activeFile.path);
    }
   }
 
   private renderColumnView = () => {
    this.contentEl.addClass("abstract-folder-columns-wrapper");
    this.contentEl.empty();
 
    let rootNodes = buildFolderTree(this.app, this.indexer.getGraph(), (a, b) => this.sortNodes(a, b));

    if (this.settings.activeGroupId) {
        const activeGroup = this.settings.groups.find(group => group.id === this.settings.activeGroupId);
        if (activeGroup) {
            rootNodes = this.filterNodesByGroup(rootNodes, activeGroup);
        }
    }
 
     if (rootNodes.length === 0) {
         this.contentEl.createEl("div", {
             text: "No abstract folders found. Add parent property to your notes to create a structure.",
             cls: "abstract-folder-empty-state"
         });
         return;
     }
 
     const columnsContainer = this.contentEl.createDiv({ cls: "abstract-folder-columns-container" });
 
     let currentNodes: FolderNode[] = rootNodes;
     let renderedDepth = 0;
 
     this.columnRenderer.renderColumn(currentNodes, columnsContainer, renderedDepth);
 
     for (let i = 0; i < this.viewState.selectionPath.length; i++) {
         const selectedPath = this.viewState.selectionPath[i];
         
         const selectedNode = currentNodes.find(node => node.path === selectedPath);
         
         if (!selectedNode) {
             break;
         }
 
         if (selectedNode && selectedNode.isFolder && selectedNode.children.length > 0) {
             currentNodes = selectedNode.children;
             renderedDepth++;
             this.columnRenderer.renderColumn(currentNodes, columnsContainer, renderedDepth, selectedPath);
         } else if (selectedNode && !selectedNode.isFolder) {
             break;
         } else {
             break;
         }
     }
   }

  private sortNodes(a: FolderNode, b: FolderNode): number {
    let compareResult: number;

    if (this.viewState.sortBy === 'name') {
      compareResult = a.path.localeCompare(b.path);
    } else if (this.viewState.sortBy === 'mtime') {
      const fileA = a.file ? this.app.vault.getAbstractFileByPath(a.path) : null;
      const fileB = b.file ? this.app.vault.getAbstractFileByPath(b.path) : null;

      const mtimeA = (fileA instanceof TFile) ? fileA.stat.mtime : 0;
      const mtimeB = (fileB instanceof TFile) ? fileB.stat.mtime : 0;
      
      compareResult = mtimeA - mtimeB;
    } else {
      compareResult = a.path.localeCompare(b.path);
    }

    return this.viewState.sortOrder === 'asc' ? compareResult : -compareResult;
  }
 
  private expandAll = () => {
    if (this.settings.viewStyle === 'tree') {
      this.contentEl.querySelectorAll(".abstract-folder-item.is-collapsed").forEach(el => {
        el.removeClass("is-collapsed");
      });
    }
  }

  private collapseAll = () => {
    if (this.settings.viewStyle === 'tree') {
      this.contentEl.querySelectorAll(".abstract-folder-item.is-folder:not(.is-collapsed)").forEach(el => {
        el.addClass("is-collapsed");
      });
    }
  }

  public async expandFolderByPath(folderPath: string) {
    const folderEl = this.contentEl.querySelector(`[data-path="${folderPath}"]`);
    if (folderEl && folderEl.hasClass("is-collapsed")) {
      folderEl.removeClass("is-collapsed");
      // Add to expanded folders in settings if rememberExpanded is true
      if (this.settings.rememberExpanded && !this.settings.expandedFolders.includes(folderPath)) {
        this.settings.expandedFolders.push(folderPath);
        await this.plugin.saveSettings();
      }
    }
  }

  private async toggleCollapse(itemEl: HTMLElement, path: string) {
    const isCollapsed = !itemEl.hasClass("is-collapsed");
    itemEl.toggleClass("is-collapsed", isCollapsed);

    if (this.settings.rememberExpanded) {
      if (isCollapsed) {
        this.settings.expandedFolders = this.settings.expandedFolders.filter(p => p !== path);
      } else {
        if (!this.settings.expandedFolders.includes(path)) {
          this.settings.expandedFolders.push(path);
        }
      }
      await this.plugin.saveSettings();
    }
  }

  private getDisplayName = (node: FolderNode): string => {
    if (node.path === HIDDEN_FOLDER_ID) {
      return "Hidden";
    }
    if (node.file) {
      if (this.settings.showAliases && node.file.extension === 'md') {
        const cache = this.app.metadataCache.getFileCache(node.file);
        const aliases = cache?.frontmatter?.aliases as unknown;
        if (aliases && Array.isArray(aliases) && aliases.length > 0) {
          return String(aliases[0]);
        } else if (typeof aliases === 'string') {
          return aliases;
        }
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
        if (activeFile) {
          this.viewState.toggleMultiSelect(activeFile.path);
        }
      }
      this.viewState.toggleMultiSelect(node.path);
      return;
    }

    this.viewState.clearMultiSelection();

    if (node.file) {
      const fileExists = this.app.vault.getAbstractFileByPath(node.file.path);
      if (fileExists) {
        this.app.workspace.getLeaf(false).openFile(node.file).catch(console.error);
      }
    }

    if (node.isFolder || node.file) {
      // Get the full path to the clicked node from the indexer
      // The problem is that getPathToRoot is deterministic and will always return the same path
      // for a multi-parent node, which might not be the path the user is currently traversing.
      // We need to construct the path based on the current column's context.

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

    const deepCopyNode = (node: FolderNode): FolderNode => {
        return {
            ...node,
            children: node.children.map(deepCopyNode)
        };
    };

    for (const includedPath of explicitlyIncludedPaths) {
        let matchingNode = allNodesMap.get(includedPath);

        if (!matchingNode) {
             const folderName = includedPath.split('/').pop();
             if (folderName) {
                 const insideNotePath = `${includedPath}/${folderName}.md`;
                 matchingNode = allNodesMap.get(insideNotePath);
             }
        }

        if (!matchingNode) {
            if (!includedPath.endsWith('.md')) {
                 const siblingNotePath = `${includedPath}.md`;
                 matchingNode = allNodesMap.get(siblingNotePath);
            }
        }

        if (matchingNode) {
            finalFilteredRoots.push(deepCopyNode(matchingNode));
        }
    }

    finalFilteredRoots.sort((a, b) => this.sortNodes(a, b));

    return finalFilteredRoots;
  }
}