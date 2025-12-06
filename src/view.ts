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

    this.viewState = new ViewState(this.settings, this.plugin);
    this.treeRenderer = new TreeRenderer(
      this.app,
      this.settings,
      this.plugin,
      this.viewState.multiSelectedPaths,
      this.getDisplayName,
      (itemEl: HTMLElement, path: string) => this.toggleCollapse(itemEl, path)
    );
    this.columnRenderer = new ColumnRenderer(
      this.app,
      this.settings,
      this.plugin,
      this.viewState.selectionPath,
      this.viewState.multiSelectedPaths,
      this.getDisplayName,
      (node, depth, event) => this.handleColumnNodeClick(node, depth, event)
    );
    this.contextMenuHandler = new ContextMenuHandler(this.app, this.settings, this.plugin);
    this.toolbar = new AbstractFolderViewToolbar(
       this.app,
       this.settings,
       this.plugin,
       this.viewState,
       this.addAction.bind(this),
       this.renderView.bind(this),
       this.expandAll.bind(this),
       this.collapseAll.bind(this),
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
    this.fileRevealManager = new FileRevealManager(
        this.app,
        this.settings,
        this.contentEl,
        this.viewState,
        this.indexer,
        this.columnRenderer,
        this.renderView.bind(this),
        this.plugin
    );

    this.toolbar.setupToolbarActions();
    this.renderView();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.registerEvent(this.app.workspace.on("abstract-folder:graph-updated" as any, this.renderView, this));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.registerEvent(this.app.workspace.on("abstract-folder:view-style-changed" as any, this.handleViewStyleChanged, this));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.registerEvent(this.app.workspace.on("abstract-folder:group-changed" as any, this.renderView, this));
    // Register events for expand/collapse all
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.registerEvent(this.app.workspace.on("abstract-folder:expand-all" as any, this.expandAll, this));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.registerEvent(this.app.workspace.on("abstract-folder:collapse-all" as any, this.collapseAll, this));

    if (this.settings.autoReveal) {
      this.registerEvent(this.app.workspace.on("file-open", this.fileRevealManager.onFileOpen, this.fileRevealManager));
    }
 
    this.contentEl.addEventListener("contextmenu", (event: MouseEvent) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        this.contextMenuHandler.showBackgroundMenu(event);
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

    // Add header for active group
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
           // eslint-disable-next-line obsidianmd/ui/sentence-case
           text: "No abstract folders found. Add 'parent: [[Parent note]]' to your notes' frontmatter to create a structure.",
           cls: "abstract-folder-empty-state"
       });
       return;
     }
 
     const treeContainer = this.contentEl.createEl("div", { cls: "abstract-folder-tree" });
     rootNodes.forEach(node => {
       this.treeRenderer.renderTreeNode(node, treeContainer, new Set(), 0);
     });
 
     if (this.settings.autoReveal) {
         const activeFile = this.app.workspace.getActiveFile();
         if (activeFile && this.fileRevealManager) {
             this.fileRevealManager.revealFile(activeFile.path);
         }
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
             // eslint-disable-next-line obsidianmd/ui/sentence-case
             text: "No abstract folders found. Add 'parent: [[Parent note]]' to your notes' frontmatter to create a structure.",
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
             break; // Break if selected node isn't found in the current column's nodes
         }
 
         if (selectedNode && selectedNode.isFolder && selectedNode.children.length > 0) {
             currentNodes = selectedNode.children; // Determine nodes for the next column
             renderedDepth++;
             this.columnRenderer.renderColumn(currentNodes, columnsContainer, renderedDepth, selectedPath);
         } else if (selectedNode && !selectedNode.isFolder) {
             break; // If a file is selected, no further columns are rendered
         } else {
             break; // Break if selected node isn't a folder with children, or somehow not found
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
 
  private expandAll() {
    if (this.settings.viewStyle === 'tree') {
      this.contentEl.querySelectorAll(".abstract-folder-item.is-collapsed").forEach(el => {
        el.removeClass("is-collapsed");
      });
    }
  }

  private collapseAll() {
    if (this.settings.viewStyle === 'tree') {
      this.contentEl.querySelectorAll(".abstract-folder-item.is-folder:not(.is-collapsed)").forEach(el => {
        el.addClass("is-collapsed");
      });
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
        const aliases = cache?.frontmatter?.aliases;
        if (aliases && Array.isArray(aliases) && aliases.length > 0) {
          return aliases[0];
        } else if (aliases && typeof aliases === 'string') {
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
        this.app.workspace.openLinkText(node.file.path, node.file.path);
      }
    }

    if (node.isFolder || node.file) { // If it's a file or folder, update the selection path
      // Get the full path to the clicked node from the indexer
      // The problem is that getPathToRoot is deterministic and will always return the same path
      // for a multi-parent node, which might not be the path the user is currently traversing.
      // We need to construct the path based on the current column's context.

      const currentColumnPath = this.viewState.selectionPath.slice(0, depth);
      const newSelectionPath = [...currentColumnPath, node.path];

      this.viewState.selectionPath = newSelectionPath;
      this.columnRenderer.setSelectionPath(this.viewState.selectionPath); // Update column renderer with the new path
      this.renderView(); // Re-render to update column highlights
    }
  }

  private filterNodesByGroup(nodes: FolderNode[], activeGroup: Group): FolderNode[] {
    const finalFilteredRoots: FolderNode[] = [];
    const explicitlyIncludedPaths = new Set(activeGroup.parentFolders.map(path => this.app.vault.getAbstractFileByPath(path)?.path).filter(Boolean) as string[]);

    // Create a flat map of all nodes in the original tree for easy lookup
    const allNodesMap = new Map<string, FolderNode>();
    const buildNodeMap = (currentNodes: FolderNode[]) => {
        for (const node of currentNodes) {
            allNodesMap.set(node.path, node);
            buildNodeMap(node.children);
        }
    };
    buildNodeMap(nodes); // Build map from the full original tree

    // Deep copy helper to ensure we don't modify the original tree nodes
    const deepCopyNode = (node: FolderNode): FolderNode => {
        return {
            ...node,
            children: node.children.map(deepCopyNode)
        };
    };

    // For each path explicitly included in the active group, find that node
    // and include its full subtree as a new root in the filtered view.
    for (const includedPath of explicitlyIncludedPaths) {
        const matchingNode = allNodesMap.get(includedPath);
        if (matchingNode) {
            // Add a deep copy of the matched node and its entire subtree
            finalFilteredRoots.push(deepCopyNode(matchingNode));
        }
    }

    // Sort the final root nodes for consistent display
    finalFilteredRoots.sort((a, b) => this.sortNodes(a, b));

    return finalFilteredRoots;
  }
}