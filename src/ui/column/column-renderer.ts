import { App, setIcon } from "obsidian";
import { FolderNode, HIDDEN_FOLDER_ID } from "../../types";
import { AbstractFolderPluginSettings } from "../../settings";
import AbstractFolderPlugin from "../../../main";
import { ContextMenuHandler } from "../context-menu";

export class ColumnRenderer {
    private app: App;
    private settings: AbstractFolderPluginSettings;
    private plugin: AbstractFolderPlugin;
    public selectionPath: string[]; // Made public so it can be updated directly from view.ts
    private multiSelectedPaths: Set<string>;
    private getDisplayName: (node: FolderNode) => string;
    private handleColumnNodeClick: (node: FolderNode, depth: number, event?: MouseEvent) => void;
    private contextMenuHandler: ContextMenuHandler;

    constructor(
        app: App,
        settings: AbstractFolderPluginSettings,
        plugin: AbstractFolderPlugin,
        selectionPath: string[],
        multiSelectedPaths: Set<string>,
        getDisplayName: (node: FolderNode) => string,
        handleColumnNodeClick: (node: FolderNode, depth: number, event?: MouseEvent) => void
    ) {
        this.app = app;
        this.settings = settings;
        this.plugin = plugin;
        this.selectionPath = selectionPath;
        this.multiSelectedPaths = multiSelectedPaths;
        this.getDisplayName = getDisplayName;
        this.handleColumnNodeClick = handleColumnNodeClick;
        this.contextMenuHandler = new ContextMenuHandler(app, settings, plugin);
    }

    // New method to update the selection path
    public setSelectionPath(path: string[]) {
        this.selectionPath = path;
    }

    renderColumn(nodes: FolderNode[], parentEl: HTMLElement, depth: number, selectedParentPath?: string) {
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

        if (activeFile && activeFile.path === node.path) {
            selfEl.addClass("is-active");
        }

        const selectionIndex = this.selectionPath.indexOf(node.path);
        if (selectionIndex > -1) {
            if (selectionIndex === this.selectionPath.length - 1) {
                selfEl.addClass("is-selected-in-column");
            } else {
                selfEl.addClass("is-ancestor-of-selected");
            }
        }

        if (this.multiSelectedPaths.has(node.path)) {
            selfEl.addClass("is-multi-selected");
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

        const parentCount = this.plugin.indexer.getGraph().childToParents.get(node.path)?.size || 0;
        if (parentCount > 1) {
            const multiParentIndicator = selfEl.createSpan({ cls: "abstract-folder-multi-parent-indicator" });
            setIcon(multiParentIndicator, "git-branch-plus");
            multiParentIndicator.ariaLabel = `${parentCount} parents`;
            multiParentIndicator.title = `${parentCount} parents`;
        }

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
            this.contextMenuHandler.showContextMenu(e, node, this.multiSelectedPaths);
          });
        }
    }
}