import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
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
    this.icon = "folder"; // You can choose a different icon
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
    const fileNodeEls = this.contentEl.querySelectorAll(`.abstract-folder-node-name[data-path="${filePath}"]`);
    fileNodeEls.forEach(el => {
      // DOM structure: node(header(name), childrenContainer(node...))
      // Actually: node -> header -> name
      // Parent is: childrenContainer -> node
      // We need to walk up the DOM opening details
      
      let currentEl = el.closest(".abstract-folder-node");
      while (currentEl) {
         const parentContainer = currentEl.parentElement;
         if (parentContainer && parentContainer.classList.contains("abstract-folder-children")) {
             parentContainer.style.display = "block";
             // Find the toggle for this container
             const parentNode = parentContainer.parentElement; // The abstract-folder-node containing this list
             if (parentNode) {
                 const toggle = parentNode.querySelector(".abstract-folder-toggle");
                 if (toggle) toggle.textContent = "▼";
             }
             currentEl = parentNode;
         } else {
             break;
         }
      }
      
      // Scroll into view (focus on the first instance found usually sufficient)
      el.scrollIntoView({ block: "center", behavior: "smooth" });
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
      this.contentEl.createEl("div", { text: "No abstract folders found. Add 'parent: [[Parent Note]]' to your notes' frontmatter to create a structure." });
      return;
    }

    const treeContainer = this.contentEl.createEl("div", { cls: "abstract-folder-tree" });
    rootNodes.forEach(node => {
      this.renderNode(node, treeContainer, new Set());
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

  private renderNode(node: FolderNode, parentEl: HTMLElement, ancestors: Set<string>) {
    if (ancestors.has(node.path)) {
      // Loop detected, stop rendering this branch
      const loopEl = parentEl.createEl("div", { cls: "abstract-folder-loop" });
      loopEl.createEl("span", { text: `Loop detected: ${node.path}`, cls: "abstract-folder-loop-text" });
      return;
    }

    const nodeEl = parentEl.createEl("div", { cls: "abstract-folder-node" });
    const headerEl = nodeEl.createEl("div", { cls: "abstract-folder-node-header" });
    const nameEl = headerEl.createEl("span", {
      text: this.getDisplayName(node),
      cls: "abstract-folder-node-name",
      attr: { "data-path": node.path }
    });

    // Highlight if this is the active file
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.path === node.path) {
        nameEl.addClass("is-active");
    }

    nameEl.on("click", ".abstract-folder-node-name", () => {
      if (node.file) {
        this.app.workspace.openLinkText(node.file.path, node.file.path);
      }
    });

    if (node.isFolder && node.children.length > 0) {
      headerEl.addClass("abstract-folder-collapsible");
      const toggleEl = headerEl.createEl("span", { cls: "abstract-folder-toggle" });
      toggleEl.setText("►"); // Right-pointing triangle

      const childrenContainer = nodeEl.createEl("div", { cls: "abstract-folder-children" });
      childrenContainer.style.display = "none";

      toggleEl.on("click", ".abstract-folder-toggle", () => {
        const isCollapsed = childrenContainer.style.display === "none";
        childrenContainer.style.display = isCollapsed ? "block" : "none";
        toggleEl.setText(isCollapsed ? "▼" : "►"); // Down-pointing or right-pointing triangle
      });

      const newAncestors = new Set(ancestors).add(node.path);
      node.children.forEach(child => {
        this.renderNode(child, childrenContainer, newAncestors);
      });
    } else if (!node.isFolder && node.file) {
        // It's a file, not a folder
        nodeEl.addClass("abstract-folder-file");
    }
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
    // For root nodes that don't correspond to an actual file but are implicit folders
    // we can just use the path as the display name.
    // Or we could have a special icon/name for implicit folders.
    return node.path.split('/').pop() || node.path;
  }
}