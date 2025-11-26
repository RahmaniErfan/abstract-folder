import { ItemView, WorkspaceLeaf, TFile, setIcon, Menu, Modal, App, Setting, Notice } from "obsidian";
import { FolderIndexer } from "./indexer";
import { FileGraph, FolderNode } from "./types";
import { AbstractFolderPluginSettings } from "./settings";
import { IconModal } from "./ui/icon-modal";
import { CreateChildModal, createChildNote } from './commands';

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

export class AbstractFolderView extends ItemView {
  private indexer: FolderIndexer;
  private settings: AbstractFolderPluginSettings;
  contentEl: HTMLElement; // Make it public to match ItemView's contentEl
  private sortOrder: 'asc' | 'desc' = 'asc'; // Default sort order
  private sortBy: 'name' | 'mtime' = 'name'; // Default sort by name. Add 'mtime' for modified time.

  constructor(leaf: WorkspaceLeaf, indexer: FolderIndexer, settings: AbstractFolderPluginSettings) {
    super(leaf);
    this.indexer = indexer;
    this.settings = settings;
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
    // Look for the item specifically
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
       
       // Add highlight class momentarily? Or rely on render refresh.
       // renderView highlights active file already.
       // But if we just opened it, renderView might not have run yet if graph didn't update.
       // However, onFileOpen is triggered by workspace, so active file is set.
       // We can manually add is-active to the self element.
       const selfEl = itemEl.querySelector(".abstract-folder-item-self");
       if (selfEl) {
           // Remove other actives
           this.contentEl.querySelectorAll(".abstract-folder-item-self.is-active").forEach(el => el.removeClass("is-active"));
           selfEl.addClass("is-active");
       }
    });
  }

  public onClose = async () => { // Corrected: single declaration as async arrow function assigned to property
    // this.registerEvent handles cleanup, no need to explicitly off
  }

  private renderView = () => {
    this.contentEl.empty();
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
      this.renderNode(node, treeContainer, new Set(), 0); // Start with depth 0
    });
  };

  private buildTree(graph: FileGraph): FolderNode[] {
    const allFilePaths = graph.allFiles;
    const parentToChildren = graph.parentToChildren;
    const childToParents = graph.childToParents;

    const rootPaths = new Set(allFilePaths);
    childToParents.forEach((_, childPath) => {
      if (rootPaths.has(childPath)) {
        rootPaths.delete(childPath);
      }
    });

    const nodesMap = new Map<string, FolderNode>();

    // Create all possible nodes
    allFilePaths.forEach(path => {
      const file = this.app.vault.getAbstractFileByPath(path);
      nodesMap.set(path, {
        file: file instanceof TFile ? file : null,
        path: path,
        children: [],
        isFolder: Object.keys(parentToChildren).includes(path), // A file is a "folder" if it has children
        icon: file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter?.icon : undefined, // Read icon from frontmatter
      });
    });

    // Link children to parents
    for (const parentPath in parentToChildren) {
      parentToChildren[parentPath].forEach(childPath => {
        const parentNode = nodesMap.get(parentPath);
        const childNode = nodesMap.get(childPath);
        if (parentNode && childNode) {
          parentNode.children.push(childNode);
        }
      });
    }

    // Sort children for consistent display
    nodesMap.forEach(node => {
      node.children.sort((a, b) => this.sortNodes(a, b));
    });

    const sortedRootNodes: FolderNode[] = [];
    rootPaths.forEach(path => {
        const node = nodesMap.get(path);
        if (node) {
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
    const collapsedItems = this.contentEl.querySelectorAll(".abstract-folder-item.is-collapsed");
    collapsedItems.forEach(el => {
      el.removeClass("is-collapsed");
    });
  }

  private collapseAll() {
    const expandableItems = this.contentEl.querySelectorAll(".abstract-folder-item.is-folder:not(.is-collapsed)");
    expandableItems.forEach(el => {
      el.addClass("is-collapsed");
    });
  }

  private renderNode(node: FolderNode, parentEl: HTMLElement, ancestors: Set<string>, depth: number) {
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
    if (node.icon) {
      const iconContainerEl = selfEl.createDiv({ cls: "abstract-folder-item-icon" });
      setIcon(iconContainerEl, node.icon); // Attempt to set as an Obsidian icon
      if (!iconContainerEl.querySelector('svg')) { // Check if an SVG element was created
        // If no SVG was created, it's likely an emoji or text, so set text directly
        iconContainerEl.setText(node.icon);
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
            node.children.forEach(child => this.renderNode(child, childrenEl, newAncestors, currentDepth));
        } else {
            // Optional: Render "Empty" text or nothing?
            // Obsidian renders empty folders just without children.
        }
    }
  }

  private toggleCollapse(itemEl: HTMLElement) {
      itemEl.toggleClass("is-collapsed", !itemEl.hasClass("is-collapsed"));
  }

  private getDisplayName(node: FolderNode): string {
    if (node.file) {
        if (this.settings.showAliases) {
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

  private showContextMenu(event: MouseEvent, node: FolderNode) {
    const menu = new Menu();

    if (node.file) { // Context menu only applies to actual files
      menu.addItem((item) =>
        item
          .setTitle("Set/Change Icon")
          .setIcon("lucide-image") // Example icon
          .onClick(() => {
            new IconModal(this.app, async (newIcon) => {
              await this.updateFileIcon(node.file!, newIcon);
            }, node.icon || "").open();
          })
      );

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

      // Add other common file actions here if desired in the future
      menu.addItem((item) =>
        item
          .setTitle("Open in New Tab")
          .setIcon("plus-square")
          .onClick(() => {
            this.app.workspace.openLinkText(node.file!.path, node.file!.path, true);
          })
      );
      

      menu.addItem((item) =>
        item
          .setTitle("Delete")
          .setIcon("trash")
          .setWarning(true) // Indicate a destructive action
          .onClick(() => {
            if (node.file) {
              this.deleteFile(node.file);
            }
          })
      );
    }
    
    menu.showAtPosition({ x: event.clientX, y: event.clientY });
  }

  private async deleteFile(file: TFile) {
    // Show a confirmation dialog
    const confirmed = await new Promise<boolean>((resolve) => {
      const confirmModal = new (class extends Modal {
        constructor(app: App, private fileToDelete: TFile, private onConfirm: (result: boolean) => void) {
          super(app);
          this.fileToDelete = fileToDelete;
          this.onConfirm = onConfirm;
        }

        onOpen() {
          this.titleEl.setText("Confirm Deletion");
          this.contentEl.createEl("p", { text: `Are you sure you want to delete "${this.fileToDelete.basename}"? This cannot be undone.` });
          new Setting(this.contentEl)
            .addButton((btn) => {
              btn.setButtonText("Delete")
                 .setWarning() // Indicate a destructive action
                 .onClick(() => {
                   this.onConfirm(true);
                   this.close();
                 });
            })
            .addButton((btn) => {
              btn.setButtonText("Cancel")
                 .onClick(() => {
                   this.onConfirm(false);
                   this.close();
                 });
            });
        }

        onClose() {
          // If modal closed without selection, assume cancel
          this.onConfirm(false);
        }
      })(this.app, file, resolve); // Pass file and resolve to the modal
      confirmModal.open();
    });


    if (confirmed) {
      try {
        await this.app.vault.delete(file);
        new Notice(`Deleted: ${file.basename}`);
        this.app.workspace.trigger('abstract-folder:graph-updated'); // Refresh view
      } catch (error) {
        new Notice(`Failed to delete file: ${error.message}`);
        console.error("Failed to delete file:", error);
      }
    }
  }

  private async updateFileIcon(file: TFile, newIcon: string) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (newIcon) {
        frontmatter.icon = newIcon;
      } else {
        delete frontmatter.icon;
      }
    });
    // Trigger a graph update or just re-render to reflect the change
    this.app.workspace.trigger('abstract-folder:graph-updated');
  }
}