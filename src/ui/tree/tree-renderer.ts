import { App, setIcon } from "obsidian";
import { FolderNode, HIDDEN_FOLDER_ID } from "../../types";
import { AbstractFolderPluginSettings } from "../../settings";
import AbstractFolderPlugin from "../../../main";
import { ContextMenuHandler } from "../context-menu";
import { FolderIndexer } from "../../indexer";

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
    
    constructor(
        app: App,
        settings: AbstractFolderPluginSettings,
        plugin: AbstractFolderPlugin,
        multiSelectedPaths: Set<string>,
        getDisplayName: (node: FolderNode) => string,
        toggleCollapse: (itemEl: HTMLElement, path: string) => Promise<void>,
        indexer: FolderIndexer // Add indexer here
    ) {
        this.app = app;
        this.settings = settings;
        this.plugin = plugin;
        this.multiSelectedPaths = multiSelectedPaths;
        this.getDisplayName = getDisplayName;
        this.toggleCollapse = toggleCollapse;
        this.contextMenuHandler = new ContextMenuHandler(app, settings, plugin, indexer);
    }

    renderTreeNode(node: FolderNode, parentEl: HTMLElement, ancestors: Set<string>, depth: number) {
        const activeFile = this.app.workspace.getActiveFile();
        // Only prevent rendering for folder loops, not for files that can appear in multiple abstract folders.
        if (node.isFolder && ancestors.has(node.path)) {
           return;
        }
const currentDepth = depth + 1;

const itemEl = parentEl.createDiv({ cls: "abstract-folder-item" });
itemEl.dataset.path = node.path;

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
                this.toggleCollapse(itemEl, node.path);
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
            this.handleNodeClick(node, e);
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

            if (node.children.length > 0) {
                const newAncestors = new Set(ancestors).add(node.path);
                node.children.forEach(child => this.renderTreeNode(child, childrenEl, newAncestors, currentDepth));
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
                this.app.workspace.getLeaf(false).openFile(node.file);

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
            // For virtual folders without a linked file, clicking toggles collapse
            const selfEl = e.currentTarget as HTMLElement; // This is .abstract-folder-item-self
            const itemEl = selfEl.parentElement; // This is .abstract-folder-item

            if (itemEl) {
                // If autoExpandChildren is enabled, toggle the collapsed state
                if (this.settings.autoExpandChildren) {
                    await this.toggleCollapse(itemEl, node.path);
                } else {
                    // If autoExpandChildren is false, behave as before: toggle collapse state
                    await this.toggleCollapse(itemEl, node.path);
                }
            }
        }
    }
}