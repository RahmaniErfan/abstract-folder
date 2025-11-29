import { ItemView, WorkspaceLeaf, TFile, setIcon, Menu, Notice } from "obsidian";
import { FolderIndexer } from "./indexer";
import { FileGraph, FolderNode, HIDDEN_FOLDER_ID } from "./types";
import { AbstractFolderPluginSettings } from "./settings";
import { CreateChildModal, createChildNote } from './commands';
import AbstractFolderPlugin from '../main'; // Import the plugin class

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

export class AbstractFolderView extends ItemView {
  private indexer: FolderIndexer;
  private settings: AbstractFolderPluginSettings;
  contentEl: HTMLElement; // Make it public to match ItemView's contentEl
  private sortOrder: 'asc' | 'desc' = 'asc'; // Default sort order
  private sortBy: 'name' | 'mtime' = 'name'; // Default sort by name. Add 'mtime' for modified time.
  private selectionPath: string[] = []; // Tracks selected nodes for column view
  private viewStyleToggleAction: HTMLElement; // To store the reference to the toggle button

  constructor(
    leaf: WorkspaceLeaf,
    indexer: FolderIndexer,
    settings: AbstractFolderPluginSettings,
    private plugin: AbstractFolderPlugin // Add plugin instance here
  ) {
    super(leaf);
    this.indexer = indexer;
    this.settings = settings;
    this.plugin = plugin; // Store the plugin instance
    this.icon = "folder-tree"; // You can choose a different icon
    this.navigation = false; // This view is not for navigation, hide nav arrows and bookmark button
  }

  getViewType(): string {
    return VIEW_TYPE_ABSTRACT_FOLDER;
  }

  getDisplayText(): string {
    return "Abstract Folders";
  }

  public onOpen = async () => { // Corrected: single declaration as async arrow function assigned to property
    this.contentEl = this.containerEl.children[1] as HTMLElement;
    this.contentEl.empty();
    this.contentEl.addClass("abstract-folder-view");

    this.addAction("arrow-up-down", "Sort order", (evt: MouseEvent) => this.showSortMenu(evt));
    this.addAction("chevrons-down", "Expand all folders", () => this.expandAll());
    this.addAction("chevrons-up", "Collapse all folders", () => this.collapseAll());
    
    // Add view style toggle button
    this.viewStyleToggleAction = this.addAction("list", "Switch View Style", () => this.toggleViewStyle());
    this.updateViewStyleToggleButton(); // Set initial icon and tooltip

    this.renderView();

    // @ts-ignore: Custom events triggered by this.app.workspace.trigger should be listened to via this.app.workspace.on
    this.registerEvent(this.app.workspace.on("abstract-folder:graph-updated", this.renderView, this));

    if (this.settings.autoReveal) {
      this.registerEvent(this.app.workspace.on("file-open", this.onFileOpen, this));
    }
  }
  
  private onFileOpen = async (file: TFile | null) => {
    if (!file || !this.settings.autoReveal) return;
    
    // We need to wait a bit for the graph to potentially update if this is a new file
    // although for navigation existing files, it should be instant.
    // Finding the node(s) corresponding to this file
    this.revealFile(file.path);
  }

  public revealFile(filePath: string) {
    // Reveal logic depends on view style
    if (this.settings.viewStyle === 'tree') {
      const fileNodeEls = this.contentEl.querySelectorAll(`.abstract-folder-item[data-path="${filePath}"]`);
      
      fileNodeEls.forEach(itemEl => {
        // Expand all parents
        let currentEl = itemEl.parentElement; // children container
        while (currentEl) {
          if (currentEl.classList.contains("abstract-folder-children")) {
            const parentItem = currentEl.parentElement; // abstract-folder-item
            if (parentItem) {
              if (parentItem.hasClass("is-collapsed")) {
                parentItem.removeClass("is-collapsed");
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
        
        // Scroll into view using 'nearest' block which only scrolls if necessary
        itemEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
        
        const selfEl = itemEl.querySelector(".abstract-folder-item-self");
        if (selfEl) {
          // Remove other actives
          this.contentEl.querySelectorAll(".abstract-folder-item-self.is-active").forEach(el => el.removeClass("is-active"));
          selfEl.addClass("is-active");
        }
      });
    } else if (this.settings.viewStyle === 'column') {
        // For column view, we need to reconstruct the selection path to reveal
        const graph = this.indexer.getGraph();
        let currentPath = filePath;
        const pathSegments: string[] = [];

        // Traverse upwards to find the full path from a root
        while (currentPath) {
            pathSegments.unshift(currentPath);
            const parents = graph.childToParents.get(currentPath);
            if (!parents || parents.size === 0) {
                break; // Reached a root
            }
            // For now, just pick the first parent if multiple, or refine logic later for multi-parent display
            currentPath = parents.values().next().value;
            if (currentPath === HIDDEN_FOLDER_ID && pathSegments[0] !== HIDDEN_FOLDER_ID) {
                // If the immediate parent is HIDDEN_FOLDER_ID, add it to path if not already there
                pathSegments.unshift(HIDDEN_FOLDER_ID);
                break;
            } else if (currentPath === HIDDEN_FOLDER_ID && pathSegments[0] === HIDDEN_FOLDER_ID) {
                // If we started at HIDDEN_FOLDER_ID, we're done.
                break;
            }
            if (pathSegments.includes(currentPath)) {
                console.warn("Circular reference detected while revealing file, stopping path reconstruction.");
                break;
            }
        }
        this.selectionPath = pathSegments;
        this.renderView(); // Re-render to show the path
        // Scroll the *last* column into view
        this.containerEl.querySelector(".abstract-folder-column:last-child")?.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }

  public onClose = async () => { // Corrected: single declaration as async arrow function assigned to property
    // this.registerEvent handles cleanup, no need to explicitly off
  }

  private renderView = () => {
    this.contentEl.empty();
    // Remove any view-specific classes before rendering
    this.contentEl.removeClass("abstract-folder-columns-wrapper");
    this.contentEl.removeClass("abstract-folder-tree-wrapper"); // Assuming a tree-specific wrapper could exist

    if (this.settings.viewStyle === 'tree') {
        this.contentEl.addClass("abstract-folder-tree-wrapper"); // Add a wrapper class for tree view layout if needed
        this.renderTreeView();
    } else {
        this.contentEl.addClass("abstract-folder-columns-wrapper"); // Add a wrapper class for column view layout
        this.renderColumnView();
    }
  };

  private renderTreeView = () => {
    const graph = this.indexer.getGraph();
    const rootNodes = this.buildTree(graph);

    if (rootNodes.length === 0) {
      this.contentEl.createEl("div", {
          text: "No abstract folders found. Add 'parent: [[Parent Note]]' to your notes' frontmatter to create a structure.",
          cls: "abstract-folder-empty-state"
      });
      return;
    }

    const treeContainer = this.contentEl.createEl("div", { cls: "abstract-folder-tree" });
    rootNodes.forEach(node => {
      this.renderTreeNode(node, treeContainer, new Set(), 0); // Start with depth 0
    });
  }

  private renderColumnView = () => {
    this.contentEl.addClass("abstract-folder-columns-wrapper"); // Add a wrapper class for column view layout
    this.contentEl.empty(); // Clear previous content

    const graph = this.indexer.getGraph();
    const rootNodes = this.buildTree(graph); // This still builds the hierarchical data

    if (rootNodes.length === 0) {
        this.contentEl.createEl("div", {
            text: "No abstract folders found. Add 'parent: [[Parent Note]]' to your notes' frontmatter to create a structure.",
            cls: "abstract-folder-empty-state"
        });
        return;
    }

    // Main container for the stacked columns
    const columnsContainer = this.contentEl.createDiv({ cls: "abstract-folder-columns-container" });

    let currentNodes: FolderNode[] = rootNodes;
    let renderedDepth = 0;

    // Render the initial column (root nodes)
    this.renderColumn(currentNodes, columnsContainer, renderedDepth);

    // Render subsequent columns based on selectionPath
    for (let i = 0; i < this.selectionPath.length; i++) {
        const selectedPath = this.selectionPath[i];
        const selectedNode = currentNodes.find(node => node.path === selectedPath);

        if (selectedNode && selectedNode.isFolder && selectedNode.children.length > 0) {
            currentNodes = selectedNode.children;
            renderedDepth++;
            this.renderColumn(currentNodes, columnsContainer, renderedDepth, selectedPath);
        } else if (selectedNode && !selectedNode.isFolder) {
            // If a file is selected, show its parent's children (if any) and highlight the file
            // and stop rendering further columns
            break;
        } else {
            // If a selected path is not found or is not a folder, stop.
            break;
        }
    }
  }

  private renderColumn(nodes: FolderNode[], parentEl: HTMLElement, depth: number, selectedParentPath?: string) {
    const columnEl = parentEl.createDiv({ cls: "abstract-folder-column", attr: { 'data-depth': depth } });
    if (selectedParentPath) {
        columnEl.dataset.parentPath = selectedParentPath;
    }

    nodes.forEach(node => {
        this.renderColumnNode(node, columnEl, depth);
    });
  }

  private renderColumnNode(node: FolderNode, parentEl: HTMLElement, depth: number) {
    const itemEl = parentEl.createDiv({ cls: "abstract-folder-item" });
    itemEl.dataset.path = node.path;

    if (node.isFolder) itemEl.addClass("is-folder");
    else itemEl.addClass("is-file");

    const selfEl = itemEl.createDiv({ cls: "abstract-folder-item-self" });

    // Highlight if active Obsidian file
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.path === node.path) {
        selfEl.addClass("is-active");
    }

    // Highlight if selected in this column view
    if (this.selectionPath.includes(node.path)) {
        selfEl.addClass("is-selected-in-column");
    }

    // Icon/Emoji (Optional)
    let iconToUse = node.icon;
    if (node.path === HIDDEN_FOLDER_ID && !iconToUse) {
      iconToUse = "eye-off"; // Default icon for the Hidden folder
    }

    if (iconToUse) {
      const iconContainerEl = selfEl.createDiv({ cls: "abstract-folder-item-icon" });
      setIcon(iconContainerEl, iconToUse);
      if (!iconContainerEl.querySelector('svg')) {
        iconContainerEl.setText(iconToUse);
      }
    }

    const innerEl = selfEl.createDiv({ cls: "abstract-folder-item-inner" });
    innerEl.setText(this.getDisplayName(node));

    // Multi-parent indicator
    const parentCount = this.indexer.getGraph().childToParents.get(node.path)?.size || 0;
    if (parentCount > 1) {
        const multiParentIndicator = innerEl.createSpan({ cls: "abstract-folder-multi-parent-indicator" });
        setIcon(multiParentIndicator, "git-branch-plus"); // Or a custom icon
        multiParentIndicator.ariaLabel = `${parentCount} parents`;
        multiParentIndicator.title = `${parentCount} parents`;
    }

    selfEl.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleColumnNodeClick(node, depth);
    });

    if (node.file) {
      selfEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.showContextMenu(e, node);
      });
    }
  }

  private handleColumnNodeClick(node: FolderNode, depth: number) {
    // Always attempt to open the file if it exists
    if (node.file) {
      this.app.workspace.openLinkText(node.file.path, node.file.path);
    }

    // If it's a folder, handle column navigation
    if (node.isFolder) {
        // If clicking a node at the current depth, or a shallower depth,
        // truncate the selectionPath
        if (depth < this.selectionPath.length) {
            this.selectionPath = this.selectionPath.slice(0, depth);
        } else if (depth === this.selectionPath.length && this.selectionPath[depth - 1] === node.path) {
            // Clicking the currently selected node at its own depth should collapse it (remove from path)
            this.selectionPath.pop();
            this.renderView();
            return;
        }
        
        // Add the clicked node to the selection path
        this.selectionPath.push(node.path);
    }
    this.renderView(); // Re-render the view with the updated selection path
  }


  private buildTree(graph: FileGraph): FolderNode[] {
    const allFilePaths = graph.allFiles;
    const parentToChildren = graph.parentToChildren;
    const childToParents = graph.childToParents;

    const nodesMap = new Map<string, FolderNode>();

    // Create all possible nodes (including HIDDEN_FOLDER_ID if it has children)
    allFilePaths.forEach(path => {
      const file = this.app.vault.getAbstractFileByPath(path);
      nodesMap.set(path, {
        file: file instanceof TFile ? file : null,
        path: path,
        children: [],
        isFolder: Object.keys(parentToChildren).includes(path) || path === HIDDEN_FOLDER_ID,
        icon: file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter?.icon : undefined,
        isHidden: path === HIDDEN_FOLDER_ID, // Mark the hidden root itself
      });
    });

    // Link children to parents and identify truly hidden nodes
    const hiddenNodes = new Set<string>(); // Tracks all nodes that are hidden, directly or indirectly

    // First pass: identify all hidden nodes (recursively)
    const identifyHiddenChildren = (nodePath: string) => {
      if (hiddenNodes.has(nodePath)) return; // Already processed
      hiddenNodes.add(nodePath);

      const children = parentToChildren[nodePath];
      if (children) {
        children.forEach(childPath => identifyHiddenChildren(childPath));
      }
    };

    if (parentToChildren[HIDDEN_FOLDER_ID]) {
      parentToChildren[HIDDEN_FOLDER_ID].forEach(childPath => {
        const childNode = nodesMap.get(childPath);
        if (childNode) {
          childNode.isHidden = true; // Mark immediate children of hidden-folder-root as hidden
          identifyHiddenChildren(childPath); // Recursively mark their children as hidden
        }
      });
    }

    // Second pass: build the tree, respecting hidden status
    for (const parentPath in parentToChildren) {
      parentToChildren[parentPath].forEach(childPath => {
        const parentNode = nodesMap.get(parentPath);
        const childNode = nodesMap.get(childPath);

        // A node should only be linked if it's not hidden AND its parent is not the HIDDEN_FOLDER_ID
        // OR if the parent is the HIDDEN_FOLDER_ID (to build the hidden subtree)
        if (parentNode && childNode) {
          if (parentPath === HIDDEN_FOLDER_ID || !hiddenNodes.has(childPath)) {
            parentNode.children.push(childNode);
          }
        }
      });
    }

    // Sort children for consistent display
    nodesMap.forEach(node => {
      node.children.sort((a, b) => this.sortNodes(a, b));
    });

    // Determine root nodes:
    // 1. Nodes that have no parents.
    // 2. The HIDDEN_FOLDER_ID itself, if it has children.
    const rootPaths = new Set(allFilePaths);
    childToParents.forEach((_, childPath) => {
      if (rootPaths.has(childPath) && !hiddenNodes.has(childPath)) {
        rootPaths.delete(childPath);
      }
    });

    const sortedRootNodes: FolderNode[] = [];
    
    // Add the "Hidden" pseudo-folder if it has children
    const hiddenFolderNode = nodesMap.get(HIDDEN_FOLDER_ID);
    if (hiddenFolderNode && hiddenFolderNode.children.length > 0) {
      sortedRootNodes.push(hiddenFolderNode);
    }

    rootPaths.forEach(path => {
        const node = nodesMap.get(path);
        if (node && !hiddenNodes.has(node.path) && node.path !== HIDDEN_FOLDER_ID) { // Exclude truly hidden nodes and the hidden pseudo-folder itself from regular roots
            sortedRootNodes.push(node);
        }
    });
    sortedRootNodes.sort((a, b) => this.sortNodes(a, b));
    return sortedRootNodes;
  }

  private sortNodes(a: FolderNode, b: FolderNode): number {
    let compareResult: number;

    if (this.sortBy === 'name') {
      compareResult = a.path.localeCompare(b.path);
    } else if (this.sortBy === 'mtime') {
      const fileA = a.file ? this.app.vault.getAbstractFileByPath(a.path) : null;
      const fileB = b.file ? this.app.vault.getAbstractFileByPath(b.path) : null;

      const mtimeA = (fileA instanceof TFile) ? fileA.stat.mtime : 0;
      const mtimeB = (fileB instanceof TFile) ? fileB.stat.mtime : 0;
      
      compareResult = mtimeA - mtimeB;
    } else {
      compareResult = a.path.localeCompare(b.path); // Default to name sort
    }

    return this.sortOrder === 'asc' ? compareResult : -compareResult;
  }

  private setSort(sortBy: 'name' | 'mtime', sortOrder: 'asc' | 'desc') {
    this.sortBy = sortBy;
    this.sortOrder = sortOrder;
    this.renderView();
  }

  private showSortMenu(event: MouseEvent) {
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle("Sort by Name (A-Z)")
        .setIcon(this.sortBy === 'name' && this.sortOrder === 'asc' ? "check" : "sort-asc")
        .onClick(() => this.setSort('name', 'asc'))
    );
    menu.addItem((item) =>
      item
        .setTitle("Sort by Name (Z-A)")
        .setIcon(this.sortBy === 'name' && this.sortOrder === 'desc' ? "check" : "sort-desc")
        .onClick(() => this.setSort('name', 'desc'))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Sort by Modified (Old to New)")
        .setIcon(this.sortBy === 'mtime' && this.sortOrder === 'asc' ? "check" : "sort-asc")
        .onClick(() => this.setSort('mtime', 'asc'))
    );
    menu.addItem((item) =>
      item
        .setTitle("Sort by Modified (New to Old)")
        .setIcon(this.sortBy === 'mtime' && this.sortOrder === 'desc' ? "check" : "sort-desc")
        .onClick(() => this.setSort('mtime', 'desc'))
    );

    menu.showAtMouseEvent(event);
  }

  private expandAll() {
    // Only applies to tree view
    if (this.settings.viewStyle === 'tree') {
      const collapsedItems = this.contentEl.querySelectorAll(".abstract-folder-item.is-collapsed");
      collapsedItems.forEach(el => {
        el.removeClass("is-collapsed");
      });
    }
  }

  private collapseAll() {
    // Only applies to tree view
    if (this.settings.viewStyle === 'tree') {
      const expandableItems = this.contentEl.querySelectorAll(".abstract-folder-item.is-folder:not(.is-collapsed)");
      expandableItems.forEach(el => {
        el.addClass("is-collapsed");
      });
    }
  }

  private renderTreeNode(node: FolderNode, parentEl: HTMLElement, ancestors: Set<string>, depth: number) {
    if (ancestors.has(node.path)) {
       // Prevent infinite loops in the tree
       return;
    }

    const currentDepth = depth + 1; // Children will be one level deeper

    const itemEl = parentEl.createDiv({ cls: "abstract-folder-item" });
    itemEl.dataset.path = node.path; // For finding it later

    if (node.isFolder) itemEl.addClass("is-folder");
    else itemEl.addClass("is-file");

    // Self Row (The clickable part)
    const selfEl = itemEl.createDiv({ cls: "abstract-folder-item-self" });
    
    // Highlight if active
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.path === node.path) {
        selfEl.addClass("is-active");
    }

    // Collapse Icon (Only for folders)
    if (node.isFolder) {
        const iconEl = selfEl.createDiv({ cls: "abstract-folder-collapse-icon" });
        setIcon(iconEl, "right-triangle"); // Use right-triangle, then rotate with CSS

        iconEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggleCollapse(itemEl);
        });
    }

    // Icon/Emoji (Optional)
    let iconToUse = node.icon;
    if (node.path === HIDDEN_FOLDER_ID && !iconToUse) {
      iconToUse = "eye-off"; // Default icon for the Hidden folder
    }

    if (iconToUse) {
      const iconContainerEl = selfEl.createDiv({ cls: "abstract-folder-item-icon" });
      setIcon(iconContainerEl, iconToUse); // Attempt to set as an Obsidian icon
      if (!iconContainerEl.querySelector('svg')) { // Check if an SVG element was created
        // If no SVG was created, it's likely an emoji or text, so set text directly
        iconContainerEl.setText(iconToUse);
      }
    }

    // Inner Content (Title)
    const innerEl = selfEl.createDiv({ cls: "abstract-folder-item-inner" });
    innerEl.setText(this.getDisplayName(node));

    // Interaction: Click Title
    innerEl.addEventListener("click", (e) => {
        e.stopPropagation();
        if (node.file) {
            this.app.workspace.openLinkText(node.file.path, node.file.path);
        } else {
            // If it's a virtual folder without a file, clicking title toggles it
            this.toggleCollapse(itemEl);
        }
    });

    // Interaction: Right-click (Context Menu) - only for actual files
    if (node.file) {
      selfEl.addEventListener("contextmenu", (e) => {
        e.preventDefault(); // Prevent default browser context menu
        this.showContextMenu(e, node);
      });
    }

    // Children Container
    if (node.isFolder) {
        const childrenEl = itemEl.createDiv({ cls: "abstract-folder-children" });
        // Default expansion state: Expanded
        // Use CSS to hide if .is-collapsed is present on itemEl

        if (this.settings.enableRainbowIndents) {
          childrenEl.addClass("rainbow-indent");
          childrenEl.addClass(`rainbow-indent-${(currentDepth -1) % 6}`); // 6 colors in the palette
          childrenEl.addClass(`${this.settings.rainbowPalette}-palette`);
        }

        if (node.children.length > 0) {
            const newAncestors = new Set(ancestors).add(node.path);
            node.children.forEach(child => this.renderTreeNode(child, childrenEl, newAncestors, currentDepth));
        } else {
            // Optional: Render "Empty" text or nothing?
            // Obsidian renders empty folders just without children.
        }
    }
  }

  private toggleCollapse(itemEl: HTMLElement) {
      itemEl.toggleClass("is-collapsed", !itemEl.hasClass("is-collapsed"));
  }

  private toggleViewStyle() {
      this.settings.viewStyle = this.settings.viewStyle === 'tree' ? 'column' : 'tree';
      this.plugin.saveSettings(); // Directly save settings via the plugin instance
      this.updateViewStyleToggleButton();
      this.renderView();
  }

  private updateViewStyleToggleButton() {
      const isColumnView = this.settings.viewStyle === 'column';
      // If current view is column, button is for switching to tree view (folder-tree as an alternative)
      // If current view is tree, button is for switching to column view (rows-2, as requested)
      setIcon(this.viewStyleToggleAction, isColumnView ? "folder-tree" : "rows-2");
      this.viewStyleToggleAction.ariaLabel = isColumnView ? "Switch to Tree View" : "Switch to Column View";
      this.viewStyleToggleAction.title = isColumnView ? "Switch to Tree View" : "Switch to Column View";
  }

  private getDisplayName(node: FolderNode): string {
    if (node.path === HIDDEN_FOLDER_ID) {
      return "Hidden"; // Special display name for the hidden root
    }
    if (node.file) {
        // Only attempt to show aliases for markdown files, as only they have frontmatter
        if (this.settings.showAliases && node.file.extension === 'md') {
            const cache = this.app.metadataCache.getFileCache(node.file);
            const aliases = cache?.frontmatter?.aliases;
            if (aliases && Array.isArray(aliases) && aliases.length > 0) {
                return aliases[0];
            } else if (aliases && typeof aliases === 'string') {
                return aliases;
            }
        }
        // For all other file types, or if aliases are not shown for markdown, return the basename
        return node.file.basename;
    }
    return node.path.split('/').pop() || node.path;
  }

  private showContextMenu(event: MouseEvent, node: FolderNode) {
    const menu = new Menu();

    if (node.file) { // Context menu only applies to actual files
      // Check if the file is currently hidden
      const fileCache = this.app.metadataCache.getFileCache(node.file);
      const parentProperty = fileCache?.frontmatter?.[this.settings.propertyName];
      let isCurrentlyHidden = false;
      if (parentProperty) {
        const parentLinks = Array.isArray(parentProperty) ? parentProperty : [parentProperty];
        isCurrentlyHidden = parentLinks.some((p: string) => p.toLowerCase().trim() === 'hidden');
      }

      if (isCurrentlyHidden) {
        menu.addItem((item) =>
          item
            .setTitle("Unhide Note")
            .setIcon("eye")
            .onClick(() => {
              this.toggleHiddenStatus(node.file!);
            })
        );
      } else {
        menu.addItem((item) =>
          item
            .setTitle("Hide Note")
            .setIcon("eye-off")
            .onClick(() => {
              this.toggleHiddenStatus(node.file!);
            })
        );
      }

      menu.addItem((item) =>
        item
          .setTitle("Create Note Here")
          .setIcon("plus-circle")
          .onClick(() => {
            new CreateChildModal(this.app, this.settings, (childName) => {
              createChildNote(this.app, this.settings, childName, node.file!);
            }).open();
          })
      );
      
      this.app.workspace.trigger("file-menu", menu, node.file, "abstract-folder-view");
    }
    
    menu.showAtPosition({ x: event.clientX, y: event.clientY });
  }

  private async toggleHiddenStatus(file: TFile) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const primaryPropertyName = this.settings.propertyName;
      const currentParents = frontmatter[primaryPropertyName];
      let parentLinks: string[] = [];

      if (typeof currentParents === 'string') {
        parentLinks = [currentParents];
      } else if (Array.isArray(currentParents)) {
        parentLinks = currentParents;
      }

      const isCurrentlyHidden = parentLinks.some((p: string) => p.toLowerCase().trim() === 'hidden');

      if (isCurrentlyHidden) {
        // Unhide: remove 'hidden' from the list of parents
        const newParents = parentLinks.filter((p: string) => p.toLowerCase().trim() !== 'hidden');
        
        if (newParents.length > 0) {
          frontmatter[primaryPropertyName] = newParents.length === 1 ? newParents[0] : newParents;
        } else {
          delete frontmatter[primaryPropertyName];
        }
        new Notice(`Unhid: ${file.basename}`);
      } else {
        // Hide: add 'hidden' to the list of parents
        if (!parentLinks.some((p: string) => p.toLowerCase().trim() === 'hidden')) { // Avoid adding 'hidden' multiple times
          parentLinks.push('hidden');
        }
        frontmatter[primaryPropertyName] = parentLinks.length === 1 ? parentLinks[0] : parentLinks;
        new Notice(`Hid: ${file.basename}`);
      }
    });
    this.app.workspace.trigger('abstract-folder:graph-updated');
  }
}