import { ItemView, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import { FolderIndexer } from "./indexer";
import { FileGraph, FolderNode } from "./types";
import { AbstractFolderPluginSettings } from "./settings";

export const VIEW_TYPE_ABSTRACT_FOLDER = "abstract-folder-view";

export class AbstractFolderView extends ItemView {
  private indexer: FolderIndexer;
  private settings: AbstractFolderPluginSettings;
  contentEl: HTMLElement; // Make it public to match ItemView's contentEl

  constructor(leaf: WorkspaceLeaf, indexer: FolderIndexer, settings: AbstractFolderPluginSettings) {
    super(leaf);
    this.indexer = indexer;
    this.settings = settings;
    this.icon = "folder-tree"; // You can choose a different icon
  }

  getViewType(): string {
    return VIEW_TYPE_ABSTRACT_FOLDER;
  }

  getDisplayText(): string {
    return "Abstract Folders";
  }

  async onOpen() {
    this.contentEl = this.containerEl.children[1] as HTMLElement;
    this.contentEl.empty();
    this.contentEl.addClass("abstract-folder-view");

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
                   parentItem.removeClass("is-collapsed");
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
       
       // Scroll into view
       itemEl.scrollIntoView({ block: "center", behavior: "smooth" });
       
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

  async onClose() {
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
      node.children.sort((a, b) => a.path.localeCompare(b.path));
    });

    const sortedRootNodes: FolderNode[] = [];
    rootPaths.forEach(path => {
        const node = nodesMap.get(path);
        if (node) {
            sortedRootNodes.push(node);
        }
    });
    sortedRootNodes.sort((a, b) => a.path.localeCompare(b.path));
    return sortedRootNodes;
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
        setIcon(iconEl, "right-triangle");
        
        iconEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggleCollapse(itemEl);
        });
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
}