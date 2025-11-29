import { ItemView, WorkspaceLeaf, TFile, setIcon, Menu, Notice } from "obsidian";
import { FolderIndexer } from "./indexer";
import { FileGraph, FolderNode, HIDDEN_FOLDER_ID } from "./types";
import { AbstractFolderPluginSettings } from "./settings";
import { CreateAbstractChildModal, createAbstractChildFile, ChildFileType, RenameModal, DeleteConfirmModal, BatchDeleteConfirmModal } from './commands'; // Updated imports
import { IconModal } from './ui/icon-modal';
import AbstractFolderPlugin from '../main'; // Import the plugin class

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

export class AbstractFolderView extends ItemView {
  private indexer: FolderIndexer;
  private settings: AbstractFolderPluginSettings;
  contentEl: HTMLElement; // Make it public to match ItemView's contentEl
  private sortOrder: 'asc' | 'desc' = 'asc'; // Default sort order
  private sortBy: 'name' | 'mtime' = 'name'; // Default sort by name. Add 'mtime' for modified time.
  private selectionPath: string[] = []; // Tracks selected nodes for column view
  private multiSelectedPaths: Set<string> = new Set(); // Tracks multi-selected files
  private viewStyleToggleAction: HTMLElement; // To store the reference to the toggle button
  private expandAllAction: HTMLElement; // Reference to the "Expand all folders" button
  private collapseAllAction: HTMLElement; // Reference to the "Collapse all folders" button

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

    this.addAction("file-plus", "Create New Root Note", () => {
        new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
            createAbstractChildFile(this.app, this.settings, childName, null, childType);
        }, 'note').open();
    });

    this.addAction("arrow-up-down", "Sort order", (evt: MouseEvent) => this.showSortMenu(evt));
    this.expandAllAction = this.addAction("chevrons-up-down", "Expand all folders", () => this.expandAll());
    this.collapseAllAction = this.addAction("chevrons-down-up", "Collapse all folders", () => this.collapseAll());
    
    // Add view style toggle button
    this.viewStyleToggleAction = this.addAction("list", "Switch View Style", () => this.toggleViewStyle());
    this.updateViewStyleToggleButton(); // Set initial icon and tooltip
    this.updateButtonStates(); // Set initial state for expand/collapse buttons

    this.renderView();

    // @ts-ignore: Custom events triggered by this.app.workspace.trigger should be listened to via this.app.workspace.on
    this.registerEvent(this.app.workspace.on("abstract-folder:graph-updated", this.renderView, this));

    if (this.settings.autoReveal) {
      this.registerEvent(this.app.workspace.on("file-open", this.onFileOpen, this));
    }

    // Add context menu for the empty space (root level actions)
    this.contentEl.addEventListener("contextmenu", (event: MouseEvent) => {
        // Prevent if the target is an item, as the item's own handler will take care of it
        // However, we need to be careful about bubbling.
        // The item's handler calls stopPropagation? No, let's check.
        // renderTreeNode adds event listener to selfEl.
        // We want this to fire only if we clicked on the background, NOT on an item.
        // Checking the target might be tricky because of children.
        // A better approach: The item listeners stop propagation, so this listener on container
        // will only catch events that bubbled up from non-handled areas or direct clicks on container.
        
        // Wait, renderTreeNode adds contextmenu to selfEl and calls e.preventDefault().
        // Does it call stopPropagation? It does not explicitly call stopPropagation() for contextmenu,
        // but it calls preventDefault().
        
        // If we want to support right-click on empty space, we should check if default was prevented.
        if (event.defaultPrevented) return;
        
        event.preventDefault();
        
        const menu = new Menu();

        menu.addItem((item) =>
            item
                .setTitle("Create New Root Note")
                .setIcon("file-plus")
                .onClick(() => {
                     new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
                        createAbstractChildFile(this.app, this.settings, childName, null, childType);
                    }, 'note').open();
                })
        );
        
        menu.addItem((item) =>
            item
                .setTitle("Create New Root Canvas")
                .setIcon("layout-dashboard")
                .onClick(() => {
                     new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
                        createAbstractChildFile(this.app, this.settings, childName, null, childType);
                    }, 'canvas').open();
                })
        );

        menu.addItem((item) =>
            item
                .setTitle("Create New Root Base")
                .setIcon("database")
                .onClick(() => {
                     new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
                        createAbstractChildFile(this.app, this.settings, childName, null, childType);
                    }, 'base').open();
                })
        );

        menu.showAtPosition({ x: event.clientX, y: event.clientY });
    });
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
                // If remembering expansion, update settings when auto-revealing too
                if (this.settings.rememberExpanded) {
                    const parentPath = parentItem.dataset.path;
                    if (parentPath && !this.settings.expandedFolders.includes(parentPath)) {
                        this.settings.expandedFolders.push(parentPath);
                        this.plugin.saveSettings(); // No await to avoid blocking render? Or should we?
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

    // Auto-reveal current file if enabled
    if (this.settings.autoReveal) {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            this.revealFile(activeFile.path);
        }
    }
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
    const activeFile = this.app.workspace.getActiveFile();
    const itemEl = parentEl.createDiv({ cls: "abstract-folder-item" });
    itemEl.dataset.path = node.path;

    if (node.isFolder) itemEl.addClass("is-folder");
    else itemEl.addClass("is-file");

    const selfEl = itemEl.createDiv({ cls: "abstract-folder-item-self" });

    // Highlight if active Obsidian file
    // const activeFile = this.app.workspace.getActiveFile(); // Already declared above for logging
    if (activeFile && activeFile.path === node.path) {
        selfEl.addClass("is-active");
    }

    // Highlight if selected in this column view
    if (this.selectionPath.includes(node.path)) {
        selfEl.addClass("is-selected-in-column");
    }

    // Highlight if multi-selected
    if (this.multiSelectedPaths.has(node.path)) {
        selfEl.addClass("is-multi-selected");
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

    // Add file type tag for files
    if (node.file && node.path !== HIDDEN_FOLDER_ID && node.file.extension !== 'md') {
      const fileTypeTag = selfEl.createDiv({ cls: "abstract-folder-file-tag" });
      fileTypeTag.setText(node.file.extension.toUpperCase());
    }

    // Multi-parent indicator
    const parentCount = this.indexer.getGraph().childToParents.get(node.path)?.size || 0;
    if (parentCount > 1) {
        const multiParentIndicator = innerEl.createSpan({ cls: "abstract-folder-multi-parent-indicator" });
        setIcon(multiParentIndicator, "git-branch-plus");
        multiParentIndicator.ariaLabel = `${parentCount} parents`;
        multiParentIndicator.title = `${parentCount} parents`;
    }

    // Add folder indicator (right arrow) for folders in column view
    if (node.isFolder && node.children.length > 0) {
        const folderIndicator = selfEl.createDiv({ cls: "abstract-folder-folder-indicator" });
        setIcon(folderIndicator, "chevron-right");
    }

    selfEl.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleColumnNodeClick(node, depth, e);
    });

    if (node.file) {
      selfEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.showContextMenu(e, node);
      });
    }
  }

  private handleColumnNodeClick(node: FolderNode, depth: number, event?: MouseEvent) {
    const isMultiSelectModifier = event && (event.altKey || event.ctrlKey || event.metaKey);

    if (isMultiSelectModifier) {
        // If starting a multi-selection and we have an active file, include it first
        if (this.multiSelectedPaths.size === 0) {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                this.multiSelectedPaths.add(activeFile.path);
            }
        }

        // Multi-select toggle
        if (this.multiSelectedPaths.has(node.path)) {
            this.multiSelectedPaths.delete(node.path);
        } else {
            this.multiSelectedPaths.add(node.path);
        }
        this.renderView();
        return;
    }

    // Single click clears multi-selection unless it was a modifier click
    if (this.multiSelectedPaths.size > 0) {
        this.multiSelectedPaths.clear();
    }

    // Always attempt to open the file if it exists
    if (node.file) {
      // Ensure file still exists before trying to open it to prevent ENOENT errors
      const fileExists = this.app.vault.getAbstractFileByPath(node.file.path);
      if (fileExists) {
          this.app.workspace.openLinkText(node.file.path, node.file.path);
      }
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
    const activeFile = this.app.workspace.getActiveFile();
    if (ancestors.has(node.path)) {
       // Prevent infinite loops in the tree
       return;
    }

    const currentDepth = depth + 1; // Children will be one level deeper

    const itemEl = parentEl.createDiv({ cls: "abstract-folder-item" });
    itemEl.dataset.path = node.path; // For finding it later

    if (node.isFolder) {
        itemEl.addClass("is-folder");
        // Check if expanded in settings or default to collapsed
        if (this.settings.rememberExpanded && this.settings.expandedFolders.includes(node.path)) {
             // It is expanded, so we do NOT add is-collapsed
        } else {
             itemEl.addClass("is-collapsed");
        }
    } else {
        itemEl.addClass("is-file");
    }

    // Self Row (The clickable part)
    const selfEl = itemEl.createDiv({ cls: "abstract-folder-item-self" });
    
    // Highlight if active
    // const activeFile = this.app.workspace.getActiveFile(); // Already declared above for logging
    if (activeFile && activeFile.path === node.path) {
        selfEl.addClass("is-active");
    }

    // Highlight if multi-selected
    if (this.multiSelectedPaths.has(node.path)) {
        selfEl.addClass("is-multi-selected");
    }

    // Collapse Icon (Only for folders)
    if (node.isFolder) {
        const iconEl = selfEl.createDiv({ cls: "abstract-folder-collapse-icon" });
        setIcon(iconEl, "chevron-right"); // Use chevron-right, then rotate with CSS

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

    // Add file type tag for files
    if (node.file && node.path !== HIDDEN_FOLDER_ID && node.file.extension !== 'md') {
      const fileTypeTag = selfEl.createDiv({ cls: "abstract-folder-file-tag" });
      fileTypeTag.setText(node.file.extension.toUpperCase());
    }

    // Interaction: Click Row (Self)
    selfEl.addEventListener("click", (e) => {
        e.stopPropagation();
        
        const isMultiSelectModifier = e.altKey || e.ctrlKey || e.metaKey;

        if (isMultiSelectModifier) {
            // If starting a multi-selection and we have an active file, include it first
            if (this.multiSelectedPaths.size === 0) {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) {
                    this.multiSelectedPaths.add(activeFile.path);
                }
            }

            // Multi-select toggle
            if (this.multiSelectedPaths.has(node.path)) {
                this.multiSelectedPaths.delete(node.path);
            } else {
                this.multiSelectedPaths.add(node.path);
            }
            this.renderView();
            return;
        }

        // Single click clears multi-selection
        if (this.multiSelectedPaths.size > 0) {
            this.multiSelectedPaths.clear();
            this.renderView();
            // Don't return, continue to process the click action (open/toggle)
            // But wait, if we just cleared selection, maybe we should just re-render and select this one?
            // Standard behavior: single click clears others and selects this one (or executes action).
            // Here, "selecting" just means executing the action (open or toggle).
        }

        if (node.file) {
            // Ensure file still exists before trying to open it
            const fileExists = this.app.vault.getAbstractFileByPath(node.file.path);
            if (fileExists) {
                this.app.workspace.openLinkText(node.file.path, node.file.path);
            }
        } else {
            // If it's a virtual folder without a file, clicking title toggles it
            this.toggleCollapse(itemEl);
        }
    });

    // Interaction: Right-click (Context Menu) - only for actual files
    if (node.file) {
      selfEl.addEventListener("contextmenu", (e) => {
        // Stop propagation so the container's context menu doesn't trigger
        e.stopPropagation();
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

  private async toggleCollapse(itemEl: HTMLElement) {
      const isCollapsed = !itemEl.hasClass("is-collapsed"); // State AFTER toggle
      itemEl.toggleClass("is-collapsed", isCollapsed);

      if (this.settings.rememberExpanded) {
          const path = itemEl.dataset.path;
          if (path) {
              if (isCollapsed) {
                   // Collapsing: remove from expanded list
                   this.settings.expandedFolders = this.settings.expandedFolders.filter(p => p !== path);
              } else {
                   // Expanding: add to expanded list
                   if (!this.settings.expandedFolders.includes(path)) {
                       this.settings.expandedFolders.push(path);
                   }
              }
              await this.plugin.saveSettings();
          }
      }
  }

  private toggleViewStyle() {
      this.settings.viewStyle = this.settings.viewStyle === 'tree' ? 'column' : 'tree';
      this.plugin.saveSettings(); // Directly save settings via the plugin instance
      this.updateViewStyleToggleButton();
      this.updateButtonStates(); // Update expand/collapse button states
      this.renderView();
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

    // If we have multiple items selected and the clicked node is one of them
    if (this.multiSelectedPaths.size > 1 && this.multiSelectedPaths.has(node.path)) {
        const selectedFiles: TFile[] = [];
        this.multiSelectedPaths.forEach(path => {
            const abstractFile = this.app.vault.getAbstractFileByPath(path);
            if (abstractFile instanceof TFile) {
                selectedFiles.push(abstractFile);
            }
        });

        // Trigger the standard 'files-menu' for multi-selection
        this.app.workspace.trigger("files-menu", menu, selectedFiles, "abstract-folder-view");
        
        // If no external plugin handled it or we want to add our own specific actions:
        menu.addSeparator();
        menu.addItem((item) =>
            item
                .setTitle(`Delete ${selectedFiles.length} items`)
                .setIcon("trash")
                .onClick(() => {
                    new BatchDeleteConfirmModal(this.app, selectedFiles, async () => {
                        for (const file of selectedFiles) {
                            await this.app.fileManager.trashFile(file);
                        }
                        this.multiSelectedPaths.clear();
                    }).open();
                })
        );
    } else {
        // Single file context menu
        if (node.file) {
            // If right-clicked file is NOT in the multi-selection, clear multi-selection
            if (!this.multiSelectedPaths.has(node.path) && this.multiSelectedPaths.size > 0) {
                this.multiSelectedPaths.clear();
                this.renderView();
            }

            menu.addItem((item) =>
              item
                .setTitle("Open in new tab")
                .setIcon("file-plus")
                .onClick(() => {
                  this.app.workspace.getLeaf('tab').openFile(node.file!);
                })
            );

            menu.addItem((item) =>
              item
                .setTitle("Open to the right")
                .setIcon("separator-vertical")
                .onClick(() => {
                  this.app.workspace.getLeaf('split').openFile(node.file!);
                })
            );

            menu.addItem((item) =>
              item
                .setTitle("Open in new window")
                .setIcon("popout")
                .onClick(() => {
                  this.app.workspace.getLeaf('window').openFile(node.file!);
                })
            );

            menu.addSeparator();
            
            // Standard single-file menu
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

      menu.addSeparator();

      // Prioritize Create Actions at the top
      menu.addItem((item) =>
        item
          .setTitle("Create Abstract Child Note")
          .setIcon("file-plus")
          .onClick(() => {
            new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
              createAbstractChildFile(this.app, this.settings, childName, node.file!, childType);
            }, 'note').open();
          })
      );
      
      menu.addItem((item) =>
        item
          .setTitle("Create Abstract Canvas Child")
          .setIcon("layout-dashboard")
          .onClick(() => {
            new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
              createAbstractChildFile(this.app, this.settings, childName, node.file!, childType);
            }, 'canvas').open();
          })
      );

      menu.addItem((item) =>
        item
          .setTitle("Create Abstract Bases Child")
          .setIcon("database")
          .onClick(() => {
            new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
              createAbstractChildFile(this.app, this.settings, childName, node.file!, childType);
            }, 'base').open();
          })
      );

      menu.addSeparator();
      
      // Standard File Operations
      menu.addItem((item) =>
        item
          .setTitle("Rename")
          .setIcon("pencil")
          .onClick(() => {
             new RenameModal(this.app, node.file!).open();
          })
      );

      menu.addItem((item) =>
        item
          .setTitle("Delete")
          .setIcon("trash")
          .onClick(() => {
             new DeleteConfirmModal(this.app, node.file!, () => {
                 this.app.fileManager.trashFile(node.file!);
             }).open();
          })
      );

            menu.addItem((item) =>
              item
                .setTitle("Set/Change Icon")
                .setIcon("image")
                .onClick(() => {
                  const currentIcon = this.app.metadataCache.getFileCache(node.file!)?.frontmatter?.icon || "";
                  new IconModal(this.app, (result) => {
                    this.updateFileIcon(node.file!, result);
                  }, currentIcon).open();
                })
            );

            // Trigger standard Obsidian file menu for extensions and other plugins
            this.app.workspace.trigger("file-menu", menu, node.file, "abstract-folder-view");
        }
    }
    
    menu.showAtPosition({ x: event.clientX, y: event.clientY });
  }

  private async updateFileIcon(file: TFile, iconName: string) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (iconName) {
        frontmatter.icon = iconName;
      } else {
        delete frontmatter.icon;
      }
    });
    // Trigger update so the view refreshes with the new icon
    this.app.workspace.trigger('abstract-folder:graph-updated');
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