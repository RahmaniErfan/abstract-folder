import { ItemView, WorkspaceLeaf, TFile, setIcon, Menu } from "obsidian";
import { FolderIndexer } from "./indexer";
import { FolderNode, HIDDEN_FOLDER_ID } from "./types";
import { AbstractFolderPluginSettings } from "./settings";
import { CreateAbstractChildModal, ChildFileType } from './ui/modals';
import AbstractFolderPlugin from '../main';
import { createAbstractChildFile } from './file-operations';
import { TreeRenderer } from './ui/tree/tree-renderer';
import { ColumnRenderer } from './ui/column/column-renderer';
import { ViewState } from './ui/view-state';
import { buildFolderTree } from './tree-utils';
import { ContextMenuHandler } from "./ui/context-menu";

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

export class AbstractFolderView extends ItemView {
  private indexer: FolderIndexer;
  private settings: AbstractFolderPluginSettings;
  contentEl: HTMLElement;
  private viewStyleToggleAction: HTMLElement;
  private expandAllAction: HTMLElement;
  private collapseAllAction: HTMLElement;

  private viewState: ViewState;
  private treeRenderer: TreeRenderer;
  private columnRenderer: ColumnRenderer;
  private contextMenuHandler: ContextMenuHandler;

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
  }

  getViewType(): string {
    return VIEW_TYPE_ABSTRACT_FOLDER;
  }

  getDisplayText(): string {
    return "Abstract Folders";
  }

  public onOpen = async () => {
    this.contentEl = this.containerEl.children[1] as HTMLElement;
    this.contentEl.empty();
    this.contentEl.addClass("abstract-folder-view");

    this.addAction("file-plus", "Create New Root Note", () => {
        new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
            createAbstractChildFile(this.app, this.settings, childName, null, childType);
        }, 'note').open();
    });

    this.addAction("arrow-up-down", "Sort order", (evt: MouseEvent) => this.showSortMenu(evt));
    this.expandAllAction = this.addAction("chevrons-up-down", "Expand all folders", () => this.expandAll());
    this.collapseAllAction = this.addAction("chevrons-down-up", "Collapse all folders", () => this.collapseAll());
    
    this.viewStyleToggleAction = this.addAction("list", "Switch View Style", () => this.viewState.toggleViewStyle());
    this.updateViewStyleToggleButton();
    this.updateButtonStates();

    this.renderView();

    this.registerEvent(this.app.workspace.on("abstract-folder:graph-updated" as any, this.renderView, this));
    this.registerEvent(this.app.workspace.on("abstract-folder:view-style-changed" as any, this.handleViewStyleChanged, this));

    if (this.settings.autoReveal) {
      this.registerEvent(this.app.workspace.on("file-open", this.onFileOpen, this));
    }

    this.contentEl.addEventListener("contextmenu", (event: MouseEvent) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        this.contextMenuHandler.showBackgroundMenu(event);
    });
  }

  private onFileOpen = async (file: TFile | null) => {
    if (!file || !this.settings.autoReveal) return;
    this.revealFile(file.path);
  }

  public revealFile(filePath: string) {
    if (this.settings.viewStyle === 'tree') {
      const fileNodeEls = this.contentEl.querySelectorAll(`.abstract-folder-item[data-path="${filePath}"]`);
      
      fileNodeEls.forEach(itemEl => {
        let currentEl = itemEl.parentElement;
        while (currentEl) {
          if (currentEl.classList.contains("abstract-folder-children")) {
            const parentItem = currentEl.parentElement;
            if (parentItem) {
              if (parentItem.hasClass("is-collapsed")) {
                parentItem.removeClass("is-collapsed");
                if (this.settings.rememberExpanded) {
                    const parentPath = parentItem.dataset.path;
                    if (parentPath && !this.settings.expandedFolders.includes(parentPath)) {
                        this.settings.expandedFolders.push(parentPath);
                        this.plugin.saveSettings();
                    }
                }
              }
              currentEl = parentItem.parentElement;
            } else {
              break;
            }
          } else if (currentEl.classList.contains("abstract-folder-tree")) {
            break;
          } else {
            currentEl = currentEl.parentElement;
          }
        }
        
        itemEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
        
        // First, remove 'is-active' from any elements that are currently active but do not match the filePath
        // First, remove 'is-active' from any elements that are currently active but do not match the filePath
        this.contentEl.querySelectorAll(".abstract-folder-item-self.is-active").forEach(el => {
            const parentItem = el.closest(".abstract-folder-item") as HTMLElement | null; // Cast to HTMLElement
            if (parentItem && parentItem.dataset.path !== filePath) {
                el.removeClass("is-active");
            }
        });
        
        // Then, ensure all instances of the *current* active file (filePath) are highlighted
        const selfElToHighlight = itemEl.querySelector(".abstract-folder-item-self");
        if (selfElToHighlight) {
          selfElToHighlight.addClass("is-active");
        }
      });
    } else if (this.settings.viewStyle === 'column') {
        const pathSegments = this.indexer.getPathToRoot(filePath);
        this.viewState.selectionPath = pathSegments;
        this.renderView();
        this.containerEl.querySelector(".abstract-folder-column:last-child")?.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }

  public onClose = async () => {
    // Cleanup is handled by registerEvent
  }

  private handleViewStyleChanged = () => {
    this.updateViewStyleToggleButton();
    this.updateButtonStates();
    this.renderView();
  }

  private renderView = () => {
    this.contentEl.empty();
    this.contentEl.removeClass("abstract-folder-columns-wrapper");
    this.contentEl.removeClass("abstract-folder-tree-wrapper");

    if (this.settings.viewStyle === 'tree') {
        this.contentEl.addClass("abstract-folder-tree-wrapper");
        this.renderTreeView();
    } else {
        this.contentEl.addClass("abstract-folder-columns-wrapper");
        this.renderColumnView();
    }
  };

  private renderTreeView = () => {
    const graph = this.indexer.getGraph();
    const rootNodes = buildFolderTree(this.app, graph, (a, b) => this.sortNodes(a, b));

    if (rootNodes.length === 0) {
      this.contentEl.createEl("div", {
          text: "No abstract folders found. Add 'parent: [[Parent Note]]' to your notes' frontmatter to create a structure.",
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
        if (activeFile) {
            this.revealFile(activeFile.path);
        }
    }
  }

  private renderColumnView = () => {
    this.contentEl.addClass("abstract-folder-columns-wrapper");
    this.contentEl.empty();

    const graph = this.indexer.getGraph();
    const rootNodes = buildFolderTree(this.app, graph, (a, b) => this.sortNodes(a, b));

    if (rootNodes.length === 0) {
        this.contentEl.createEl("div", {
            text: "No abstract folders found. Add 'parent: [[Parent Note]]' to your notes' frontmatter to create a structure.",
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

  private showSortMenu(event: MouseEvent) {
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle("Sort by Name (A-Z)")
        .setIcon(this.viewState.sortBy === 'name' && this.viewState.sortOrder === 'asc' ? "check" : "sort-asc")
        .onClick(() => this.viewState.setSort('name', 'asc'))
    );
    menu.addItem((item) =>
      item
        .setTitle("Sort by Name (Z-A)")
        .setIcon(this.viewState.sortBy === 'name' && this.viewState.sortOrder === 'desc' ? "check" : "sort-desc")
        .onClick(() => this.viewState.setSort('name', 'desc'))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Sort by Modified (Old to New)")
        .setIcon(this.viewState.sortBy === 'mtime' && this.viewState.sortOrder === 'asc' ? "check" : "sort-asc")
        .onClick(() => this.viewState.setSort('mtime', 'asc'))
    );
    menu.addItem((item) =>
      item
        .setTitle("Sort by Modified (New to Old)")
        .setIcon(this.viewState.sortBy === 'mtime' && this.viewState.sortOrder === 'desc' ? "check" : "sort-desc")
        .onClick(() => this.viewState.setSort('mtime', 'desc'))
    );

    menu.showAtMouseEvent(event);
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

  private updateButtonStates() {
    const isTreeView = this.settings.viewStyle === 'tree';
    if (this.expandAllAction) {
        this.expandAllAction.toggleClass('is-disabled', !isTreeView);
        this.expandAllAction.toggleAttribute('disabled', !isTreeView);
    }
    if (this.collapseAllAction) {
        this.collapseAllAction.toggleClass('is-disabled', !isTreeView);
        this.collapseAllAction.toggleAttribute('disabled', !isTreeView);
    }
  }

  private updateViewStyleToggleButton() {
      const isColumnView = this.settings.viewStyle === 'column';
      setIcon(this.viewStyleToggleAction, isColumnView ? "folder-tree" : "rows-2");
      this.viewStyleToggleAction.ariaLabel = isColumnView ? "Switch to Tree View" : "Switch to Column View";
      this.viewStyleToggleAction.title = isColumnView ? "Switch to Tree View" : "Switch to Column View";
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
        const fullPathToNode = this.indexer.getPathToRoot(node.path);
        this.viewState.selectionPath = fullPathToNode;
        this.columnRenderer.setSelectionPath(this.viewState.selectionPath); // Update column renderer with the new path
        this.renderView(); // Re-render to update column highlights
    }
  }
}