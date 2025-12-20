import { App, setIcon } from "obsidian";
import { FolderNode, HIDDEN_FOLDER_ID } from "../../types";
import { AbstractFolderPluginSettings } from "../../settings";
import AbstractFolderPlugin from "../../../main";
import { ContextMenuHandler } from "../context-menu";
import { FolderIndexer } from "src/indexer";
import { DragManager } from "../dnd/drag-manager";

export class ColumnRenderer {
    private app: App;
    private settings: AbstractFolderPluginSettings;
    private plugin: AbstractFolderPlugin;
    public selectionPath: string[]; // Made public so it can be updated directly from view.ts
    private multiSelectedPaths: Set<string>;
    private getDisplayName: (node: FolderNode) => string;
    private handleColumnNodeClick: (node: FolderNode, depth: number, event?: MouseEvent) => void;
    private contextMenuHandler: ContextMenuHandler;
    private dragManager: DragManager;
    private getContentEl: () => HTMLElement;

    constructor(
        app: App,
        settings: AbstractFolderPluginSettings,
        plugin: AbstractFolderPlugin,
        selectionPath: string[],
        multiSelectedPaths: Set<string>,
        getDisplayName: (node: FolderNode) => string,
        handleColumnNodeClick: (node: FolderNode, depth: number, event?: MouseEvent) => void,
        indexer: FolderIndexer,
        dragManager: DragManager,
        getContentEl: () => HTMLElement
    ) {
        this.app = app;
        this.settings = settings;
        this.plugin = plugin;
        this.selectionPath = selectionPath;
        this.multiSelectedPaths = multiSelectedPaths;
        this.getDisplayName = getDisplayName;
        this.handleColumnNodeClick = handleColumnNodeClick;
        this.contextMenuHandler = new ContextMenuHandler(app, settings, plugin, indexer);
        this.dragManager = dragManager;
        this.getContentEl = getContentEl;
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
            this.renderColumnNode(node, columnEl, depth, selectedParentPath || "");
        });
    }

    private renderColumnNode(node: FolderNode, parentEl: HTMLElement, depth: number, parentPath: string) {
        // TEMPORARY DEBUG: Trace why files are treated as folders
        const isFolder = node.isFolder && node.children.length > 0;
        // Debug logging removed
        // if (node.path.includes('file_') && isFolder) {
        //     console.debug(`[ColumnRenderer] rendering ${node.path}: isFolder=${node.isFolder}, childrenCount=${node.children.length}, childrenNames=${node.children.map(c => c.path).join(', ')}`);
        // } else {
        //     console.debug(`[ColumnRenderer] rendering ${node.path}: isFolder=${node.isFolder}, childrenCount=${node.children.length}`);
        // }

        const activeFile = this.app.workspace.getActiveFile();
        const itemEl = parentEl.createDiv({ 
            cls: "abstract-folder-item",
            attr: { 'data-path': node.path }
        });
        itemEl.draggable = true;

        itemEl.addEventListener("dragstart", (e) => this.dragManager.handleDragStart(e, node, parentPath, this.multiSelectedPaths));
        itemEl.addEventListener("dragover", (e) => this.dragManager.handleDragOver(e, node));
        itemEl.addEventListener("dragleave", (e) => this.dragManager.handleDragLeave(e));
        itemEl.addEventListener("drop", (e) => {
            this.dragManager.handleDrop(e, node).catch(console.error);
        });

        if (isFolder) {
            itemEl.addClass("is-folder");
        } else {
            itemEl.addClass("is-file");
        }

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
        const childCount = node.children.length;
        
        // Only show folder indicator if it's truly a folder with children in our graph
        if (node.isFolder && childCount > 0) {
            const folderIndicator = selfEl.createDiv({ cls: "abstract-folder-folder-indicator" });
            setIcon(folderIndicator, "chevron-right");
        }

        if (parentCount > 1) {
            const multiParentIndicator = selfEl.createSpan({ cls: "abstract-folder-multi-parent-indicator" });
            setIcon(multiParentIndicator, "git-branch-plus");
            multiParentIndicator.ariaLabel = `${parentCount} parents`;
            multiParentIndicator.title = `${parentCount} parents`;
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
