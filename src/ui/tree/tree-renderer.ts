import { App, setIcon, TFile } from "obsidian";
import { FolderNode, HIDDEN_FOLDER_ID } from "../../types";
import { AbstractFolderPluginSettings } from "../../settings";
import AbstractFolderPlugin from "../../../main";
import { ContextMenuHandler } from "../context-menu";
import { FolderIndexer } from "../../indexer";
import { DragManager } from "../dnd/drag-manager";
import { FlatItem } from "../../utils/virtualization";
import { Logger } from "../../utils/logger";
import { FileRevealManager } from "../../file-reveal-manager";

export type FocusFileCallback = (path: string) => void;

function stringToNumberHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return hash;
}

interface ExtendedHTMLElement extends HTMLElement {
    _folderNode?: FolderNode;
    _ancestors?: Set<string>;
    _contextId?: string;
}

export class TreeRenderer {
    public fileRevealManager?: FileRevealManager;
    private app: App;
    private settings: AbstractFolderPluginSettings;
    private plugin: AbstractFolderPlugin;
    private multiSelectedPaths: Set<string>;
    private getDisplayName: (node: FolderNode) => string;
    private toggleCollapse: (itemEl: HTMLElement, path: string, contextId?: string) => Promise<void>;
    private indexer: FolderIndexer;
    private contextMenuHandler: ContextMenuHandler;
    private dragManager: DragManager;

    constructor(
        app: App,
        settings: AbstractFolderPluginSettings,
        plugin: AbstractFolderPlugin,
        multiSelectedPaths: Set<string>,
        getDisplayName: (node: FolderNode) => string,
        toggleCollapse: (itemEl: HTMLElement, path: string, contextId?: string) => Promise<void>,
        indexer: FolderIndexer, // Add indexer here
        dragManager: DragManager,
        focusFile: FocusFileCallback
    ) {
        this.app = app;
        this.settings = settings;
        this.plugin = plugin;
        this.multiSelectedPaths = multiSelectedPaths;
        this.getDisplayName = getDisplayName;
        this.toggleCollapse = toggleCollapse;
        this.indexer = indexer;
        this.contextMenuHandler = new ContextMenuHandler(app, settings, plugin, indexer, focusFile);
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
    this.dragManager.handleDrop(e, node).catch(Logger.error);
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

        // Unified check for folder-like behavior using Indexer as source of truth
        const childrenInGraphRecursive = this.indexer.getGraph().parentToChildren[node.path];
        const hasEffectiveChildrenRecursive = (childrenInGraphRecursive && childrenInGraphRecursive.size > 0) || (node.children && node.children.length > 0);
        const isEffectiveFolderRecursive = node.isFolder || hasEffectiveChildrenRecursive;

        if (isEffectiveFolderRecursive) {
            const iconEl = selfEl.createDiv({ cls: "abstract-folder-collapse-icon" });
            setIcon(iconEl, "chevron-right");

            iconEl.addEventListener("click", (e) => {
                e.stopPropagation();
                this.toggleCollapse(itemEl, node.path, (itemEl as ExtendedHTMLElement)._contextId).catch(Logger.error);
            });
        }

        let iconToUse = node.icon;
        if (node.path === HIDDEN_FOLDER_ID && !iconToUse) {
          iconToUse = "eye-off";
        }

        // If it's an effective folder and has no custom icon, show folder icon
        if (isEffectiveFolderRecursive && !iconToUse) {
            const contextId = (itemEl as ExtendedHTMLElement)._contextId;
            const isExpanded = contextId ? this.settings.expandedFolders.includes(contextId) : this.settings.expandedFolders.includes(node.path);
            iconToUse = isExpanded ? "folder-open" : "folder-closed";
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

        if (node.file && node.path !== HIDDEN_FOLDER_ID && node.file instanceof TFile && node.file.extension !== 'md') {
          const fileTypeTag = selfEl.createDiv({ cls: "abstract-folder-file-tag" });
          fileTypeTag.setText(node.file.extension.toUpperCase());
        }

        selfEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.handleNodeClick(node, e).catch(Logger.error);
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
        const contextId = item.contextId;
        const activeFile = this.app.workspace.getActiveFile();

        const itemEl = container.createDiv({ cls: "abstract-folder-item abstract-folder-virtual-item" });
        itemEl.style.setProperty('top', `${top}px`);
        itemEl.dataset.contextId = contextId;

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
        // @ts-ignore
        itemEl._contextId = contextId;

        itemEl.draggable = true;

        itemEl.addEventListener("dragstart", (e) => this.dragManager.handleDragStart(e, node, item.parentPath || "", this.multiSelectedPaths));
        itemEl.addEventListener("dragover", (e) => this.dragManager.handleDragOver(e, node));
        itemEl.addEventListener("dragleave", (e) => this.dragManager.handleDragLeave(e));
        itemEl.addEventListener("drop", (e) => {
            this.dragManager.handleDrop(e, node).catch(Logger.error);
        });

        // Unified check for folder-like behavior using Indexer as source of truth
        const childrenInGraph = this.indexer.getGraph().parentToChildren[node.path];
        const hasEffectiveChildren = (childrenInGraph && childrenInGraph.size > 0) || (node.children && node.children.length > 0);
        const isEffectiveFolder = node.isFolder || hasEffectiveChildren;

        if (isEffectiveFolder) {
            itemEl.addClass("is-folder");
            if (!this.settings.expandedFolders.includes(contextId)) {
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

        if (isEffectiveFolder) {
            const iconEl = selfEl.createDiv({ cls: "abstract-folder-collapse-icon" });
            setIcon(iconEl, "chevron-right");

            iconEl.addEventListener("click", (e) => {
                e.stopPropagation();
                this.toggleCollapse(itemEl, node.path, contextId).catch(Logger.error);
            });
        }

        let iconToUse = node.icon;
        if (node.path === HIDDEN_FOLDER_ID && !iconToUse) {
            iconToUse = "eye-off";
        }

        // If it's an effective folder (even if it's a file), and has no custom icon, show folder icon
        if (isEffectiveFolder && !iconToUse) {
            const isExpanded = contextId ? this.settings.expandedFolders.includes(contextId) : this.settings.expandedFolders.includes(node.path);
            iconToUse = isExpanded ? "folder-open" : "folder-closed";
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

        if (node.file && node.path !== HIDDEN_FOLDER_ID && node.file instanceof TFile && node.file.extension !== 'md') {
          const fileTypeTag = selfEl.createDiv({ cls: "abstract-folder-file-tag" });
          fileTypeTag.setText(node.file.extension.toUpperCase());
        }

        selfEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.handleNodeClick(node, e).catch(Logger.error);
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
        if (node.file instanceof TFile) {
            const fileExists = this.app.vault.getAbstractFileByPath(node.file.path);
            if (fileExists) {
                // Open in new tab (true = split leaf)
                this.app.workspace.getLeaf('tab').openFile(node.file).catch(Logger.error);
            }
        }
    }

    private async handleNodeClick(node: FolderNode, e: MouseEvent) {
        // Record last interaction context
        const selfEl = e.currentTarget as HTMLElement;
        const itemEl = selfEl.closest('.abstract-folder-item') as ExtendedHTMLElement;
        const contextId = itemEl?._contextId || itemEl?.dataset.contextId;

        if (contextId) {
            this.settings.lastInteractionContextId = contextId;
            void this.plugin.saveSettings();
        }

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

        // UNIFIED CHILD DETECTION: Use Indexer as source of truth to avoid virtualization issues
        const graph = this.indexer.getGraph();
        const childrenInGraph = graph.parentToChildren[node.path];
        const hasEffectiveChildren = (childrenInGraph && childrenInGraph.size > 0) || (node.children && node.children.length > 0);
        
        let togglePerformed = false;

        // 1. Handle File Opening
        if (node.file instanceof TFile) {
            const fileExists = this.app.vault.getAbstractFileByPath(node.file.path);
            if (fileExists) {
                if (this.fileRevealManager) {
                    this.fileRevealManager.setInternalClick(true);
                }
                this.app.workspace.getLeaf(false).openFile(node.file).catch(Logger.error);

                // If this file also has children and autoExpandChildren is enabled, we mark for toggle
                if (this.settings.autoExpandChildren && hasEffectiveChildren) {
                    togglePerformed = true;
                }
            }
        } else if (node.isFolder || hasEffectiveChildren || node.path === HIDDEN_FOLDER_ID || node.path === 'abstract-hidden-root') {
            // 2. Handle Folder Toggling (when no file is associated)
            togglePerformed = true;
        }

        // 3. Perform Toggle if needed
        if (togglePerformed) {
            const targetItemEl = itemEl || (selfEl.parentElement as HTMLElement);
            if (targetItemEl) {
                const effectiveContextId = (targetItemEl as ExtendedHTMLElement)._contextId;
                await this.toggleCollapse(targetItemEl, node.path, effectiveContextId);
            }
        }
    }
}