import { App, setIcon } from "obsidian";
import { FolderNode, HIDDEN_FOLDER_ID } from "../../types";
import { AbstractFolderPluginSettings } from "../../settings";
import AbstractFolderPlugin from "../../../main";
import { ContextMenuHandler } from "../context-menu";
import { FolderIndexer } from "../../indexer";
import { DragManager } from "../dnd/drag-manager";
import { FlatItem } from "../../utils/virtualization";

function stringToNumberHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return hash;
}

export class TreeRenderer {
    private app: App;
    private settings: AbstractFolderPluginSettings;
    private plugin: AbstractFolderPlugin;
    private multiSelectedPaths: Set<string>;
    private getDisplayName: (node: FolderNode) => string;
    private toggleCollapse: (itemEl: HTMLElement, path: string) => Promise<void>;
    private contextMenuHandler: ContextMenuHandler;
    private dragManager: DragManager;

    constructor(
        app: App,
        settings: AbstractFolderPluginSettings,
        plugin: AbstractFolderPlugin,
        multiSelectedPaths: Set<string>,
        getDisplayName: (node: FolderNode) => string,
        toggleCollapse: (itemEl: HTMLElement, path: string) => Promise<void>,
        indexer: FolderIndexer, // Add indexer here
        dragManager: DragManager
    ) {
        this.app = app;
        this.settings = settings;
        this.plugin = plugin;
        this.multiSelectedPaths = multiSelectedPaths;
        this.getDisplayName = getDisplayName;
        this.toggleCollapse = toggleCollapse;
        this.contextMenuHandler = new ContextMenuHandler(app, settings, plugin, indexer);
        this.dragManager = dragManager;
    }

    public setHighlightedPath(path: string | null) {
        const existing = this.plugin.app.workspace.containerEl.querySelectorAll('.abstract-folder-item-self.is-search-match');
        existing.forEach(el => el.removeClass('is-search-match'));

        if (path) {
            const itemEl = this.plugin.app.workspace.containerEl.querySelector(`.abstract-folder-item[data-path="${path}"] .abstract-folder-item-self`);
            if (itemEl) {
                itemEl.addClass('is-search-match');
                
                setTimeout(() => {
                    itemEl.removeClass('is-search-match');
                }, 2000);
            }
        }
    }

    // Recursive method to render standard tree view
    renderTreeNode(node: FolderNode, parentEl: HTMLElement, ancestors: Set<string>, depth: number, parentPath: string | null) {
        const activeFile = this.app.workspace.getActiveFile();
        // Only prevent rendering for folder loops, not for files that can appear in multiple abstract folders.
        if (node.isFolder && ancestors.has(node.path)) {
           return;
        }
const currentDepth = depth + 1;

const itemEl = parentEl.createDiv({ cls: "abstract-folder-item" });
itemEl.dataset.path = node.path;
itemEl.dataset.depth = String(depth);
// @ts-ignore - Storing node data on element for easy access in event handlers
itemEl._folderNode = node;
// @ts-ignore - Storing ancestors data on element for recursive rendering
itemEl._ancestors = ancestors;

itemEl.draggable = true;

itemEl.addEventListener("dragstart", (e) => this.dragManager.handleDragStart(e, node, parentPath || "", this.multiSelectedPaths));
itemEl.addEventListener("dragover", (e) => this.dragManager.handleDragOver(e, node));
itemEl.addEventListener("dragleave", (e) => this.dragManager.handleDragLeave(e));
itemEl.addEventListener("drop", (e) => {
    this.dragManager.handleDrop(e, node).catch(console.error);
});

if (node.isFolder) {
    itemEl.addClass("is-folder");
    if (this.settings.rememberExpanded && this.settings.expandedFolders.includes(node.path)) {
        // Expanded
    } else {
        itemEl.addClass("is-collapsed");
    }
} else {
    itemEl.addClass("is-file");
}

const selfEl = itemEl.createDiv({ cls: "abstract-folder-item-self" });

if (activeFile && activeFile.path === node.path) {
    selfEl.addClass("is-active");
}

        if (this.multiSelectedPaths.has(node.path)) {
            selfEl.addClass("is-multi-selected");
        }

        if (node.isFolder) {
            const iconEl = selfEl.createDiv({ cls: "abstract-folder-collapse-icon" });
            setIcon(iconEl, "chevron-right");

            iconEl.addEventListener("click", (e) => {
                e.stopPropagation();
                this.toggleCollapse(itemEl, node.path).catch(console.error);
            });
        }

        let iconToUse = node.icon;
        if (node.path === HIDDEN_FOLDER_ID && !iconToUse) {
          iconToUse = "eye-off";
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

        if (node.file && node.path !== HIDDEN_FOLDER_ID && node.file.extension !== 'md') {
          const fileTypeTag = selfEl.createDiv({ cls: "abstract-folder-file-tag" });
          fileTypeTag.setText(node.file.extension.toUpperCase());
        }

        selfEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.handleNodeClick(node, e).catch(console.error);
        });

        selfEl.addEventListener("auxclick", (e) => {
            if (e.button === 1) { // Middle click
                e.stopPropagation();
                this.handleNodeMiddleClick(node, e);
            }
        });

        if (node.file) {
          selfEl.addEventListener("contextmenu", (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.contextMenuHandler.showContextMenu(e, node, this.multiSelectedPaths);
          });
        }

        if (node.isFolder) {
            const childrenEl = itemEl.createDiv({ cls: "abstract-folder-children" });
            if (this.settings.enableRainbowIndents) {
              childrenEl.addClass("rainbow-indent");
              let colorIndex: number;
              if (this.settings.enablePerItemRainbowColors) {
                  // Use depth + a hash of the path for varied colors within the same depth
                  colorIndex = Math.abs(((currentDepth - 1) + stringToNumberHash(node.path)) % 10); // Use 10 colors
              } else {
                  // Use only depth for consistent colors at each level
                  colorIndex = (currentDepth - 1) % 10; // Use 10 colors
              }
              childrenEl.addClass(`rainbow-indent-${colorIndex}`);
              childrenEl.addClass(`${this.settings.rainbowPalette}-palette`);
            }

            // Lazy Rendering: Only render children if expanded
            if (this.settings.expandedFolders.includes(node.path)) {
                if (node.children.length > 0) {
                    const newAncestors = new Set(ancestors).add(node.path);
                    node.children.forEach(child => this.renderTreeNode(child, childrenEl, newAncestors, currentDepth, node.path));
                }
            }
        }
    }

    public renderChildren(itemEl: HTMLElement) {
        // @ts-ignore - Accessing custom property stored on element
        const node = itemEl._folderNode as FolderNode;
        // @ts-ignore - Accessing custom property stored on element
        const ancestors = itemEl._ancestors as Set<string>;
        const depth = parseInt(itemEl.dataset.depth || "0");
        
        if (!node || !node.isFolder) return;

        const childrenEl = itemEl.querySelector('.abstract-folder-children') as HTMLElement;
        if (!childrenEl) return;
        
        // If already rendered, skip
        if (childrenEl.childElementCount > 0) return;

        const currentDepth = depth + 1;
        const newAncestors = new Set(ancestors).add(node.path);
        
        node.children.forEach(child => this.renderTreeNode(child, childrenEl, newAncestors, currentDepth, node.path));
    }

    // Virtualized rendering for high-performance tree view
    public renderFlatItem(item: FlatItem, container: HTMLElement | DocumentFragment, top: number) {
        const node = item.node;
        const depth = item.depth;
        const activeFile = this.app.workspace.getActiveFile();

        const itemEl = container.createDiv({ cls: "abstract-folder-item abstract-folder-virtual-item" });
        itemEl.style.setProperty('top', `${top}px`);

        if (this.settings.enableRainbowIndents && depth > 0) {
            const guidesContainer = itemEl.createDiv({ cls: "abstract-folder-indent-guides" });

            for (let i = 0; i < depth; i++) {
                const guide = guidesContainer.createDiv({ cls: "abstract-folder-indent-guide" });
                guide.style.setProperty('left', `${6 + (i * 20)}px`);
                
                guide.addClass("rainbow-indent");
                guide.addClass(`${this.settings.rainbowPalette}-palette`);
                
                const colorIndex = i % 10;
                guide.addClass(`rainbow-indent-${colorIndex}`);
            }
        }
        
        itemEl.dataset.path = node.path;
        itemEl.dataset.depth = String(depth);
        // @ts-ignore - Storing node data on element for easy access in event handlers
        itemEl._folderNode = node;

        itemEl.draggable = true;

        itemEl.addEventListener("dragstart", (e) => this.dragManager.handleDragStart(e, node, item.parentPath || "", this.multiSelectedPaths));
        itemEl.addEventListener("dragover", (e) => this.dragManager.handleDragOver(e, node));
        itemEl.addEventListener("dragleave", (e) => this.dragManager.handleDragLeave(e));
        itemEl.addEventListener("drop", (e) => {
            this.dragManager.handleDrop(e, node).catch(console.error);
        });

        if (node.isFolder) {
            itemEl.addClass("is-folder");
            if (!this.settings.expandedFolders.includes(node.path)) {
                itemEl.addClass("is-collapsed");
            }
        } else {
            itemEl.addClass("is-file");
        }

        const selfEl = itemEl.createDiv({ cls: "abstract-folder-item-self" });
        selfEl.style.setProperty('padding-left', `${6 + (depth * 20)}px`);

        if (activeFile && activeFile.path === node.path) {
            selfEl.addClass("is-active");
        }

        if (this.multiSelectedPaths.has(node.path)) {
            selfEl.addClass("is-multi-selected");
        }

        if (node.isFolder) {
            const iconEl = selfEl.createDiv({ cls: "abstract-folder-collapse-icon" });
            setIcon(iconEl, "chevron-right");

            iconEl.addEventListener("click", (e) => {
                e.stopPropagation();
                this.toggleCollapse(itemEl, node.path).catch(console.error);
            });
        }

        let iconToUse = node.icon;
        if (node.path === HIDDEN_FOLDER_ID && !iconToUse) {
          iconToUse = "eye-off";
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

        if (node.file && node.path !== HIDDEN_FOLDER_ID && node.file.extension !== 'md') {
          const fileTypeTag = selfEl.createDiv({ cls: "abstract-folder-file-tag" });
          fileTypeTag.setText(node.file.extension.toUpperCase());
        }

        selfEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.handleNodeClick(node, e).catch(console.error);
        });

        selfEl.addEventListener("auxclick", (e) => {
            if (e.button === 1) { // Middle click
                e.stopPropagation();
                this.handleNodeMiddleClick(node, e);
            }
        });

        if (node.file) {
          selfEl.addEventListener("contextmenu", (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.contextMenuHandler.showContextMenu(e, node, this.multiSelectedPaths);
          });
        }
    }

    private handleNodeMiddleClick(node: FolderNode, e: MouseEvent) {
        if (node.file) {
            const fileExists = this.app.vault.getAbstractFileByPath(node.file.path);
            if (fileExists) {
                // Open in new tab (true = split leaf)
                this.app.workspace.getLeaf('tab').openFile(node.file).catch(console.error);
            }
        }
    }

    private async handleNodeClick(node: FolderNode, e: MouseEvent) {
        const isMultiSelectModifier = e.altKey || e.ctrlKey || e.metaKey;

        if (isMultiSelectModifier) {
            if (this.multiSelectedPaths.size === 0) {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) {
                    this.multiSelectedPaths.add(activeFile.path);
                }
            }

            if (this.multiSelectedPaths.has(node.path)) {
                this.multiSelectedPaths.delete(node.path);
            } else {
                this.multiSelectedPaths.add(node.path);
            }
            this.plugin.app.workspace.trigger('abstract-folder:graph-updated'); // Re-render to show selection
            return;
        }

        if (this.multiSelectedPaths.size > 0) {
            this.multiSelectedPaths.clear();
            this.plugin.app.workspace.trigger('abstract-folder:graph-updated'); // Re-render to clear selection
        }

        if (node.file) {
            const fileExists = this.app.vault.getAbstractFileByPath(node.file.path);
            if (fileExists) {
                this.app.workspace.getLeaf(false).openFile(node.file).catch(console.error);

                // If this file also has children and autoExpandChildren is enabled, toggle its expanded state
                if (this.settings.autoExpandChildren && node.children.length > 0) {
                    const selfEl = e.currentTarget as HTMLElement;
                    const itemEl = selfEl.parentElement; // The .abstract-folder-item
                    if (itemEl) {
                        await this.toggleCollapse(itemEl, node.path);
                    }
                }
            }
        } else if (node.isFolder) {
            const selfEl = e.currentTarget as HTMLElement;
            const itemEl = selfEl.parentElement;

            if (itemEl) {
                await this.toggleCollapse(itemEl, node.path);
            }
        }
    }
}