import { App, setIcon } from "obsidian";
import { FolderNode, HIDDEN_FOLDER_ID, FileGraph } from "../../types";
import { VIEW_TYPE_ABSTRACT_FOLDER, AbstractFolderView } from "../view/abstract-folder-view";
import { AbstractFolderPluginSettings } from "../../settings";
import AbstractFolderPlugin from "../../../main";
import { ContextMenuHandler } from "../context-menu";
import { FolderIndexer } from "src/indexer";
import { DragManager } from "../dnd/drag-manager";

export class ColumnRenderer {
    private app: App;
    private settings: AbstractFolderPluginSettings;
    private plugin: AbstractFolderPlugin;
    public selectionPath: string[];
    private multiSelectedPaths: Set<string>;
    private getDisplayName: (node: FolderNode) => string;
    private handleColumnNodeClick: (node: FolderNode, depth: number, event?: MouseEvent) => void;
    private handleColumnExpand: (node: FolderNode, depth: number) => void;
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
        handleColumnExpand: (node: FolderNode, depth: number) => void,
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
        this.handleColumnExpand = handleColumnExpand;
        this.contextMenuHandler = new ContextMenuHandler(app, settings, plugin, indexer, (path) => {
           const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_ABSTRACT_FOLDER);
           if (leaves.length > 0) {
               const view = leaves[0].view;
               if (view instanceof AbstractFolderView) {
                   view.focusFile(path);
               }
           }
        });
        this.dragManager = dragManager;
        this.getContentEl = getContentEl;
    }

    public setSelectionPath(path: string[]) {
        this.selectionPath = path;
    }

    renderColumn(nodes: FolderNode[], parentEl: HTMLElement, depth: number, selectedParentPath?: string) {
        const columnEl = parentEl.createDiv({ cls: "abstract-folder-column", attr: { 'data-depth': depth } });
        if (selectedParentPath) {
            columnEl.dataset.parentPath = selectedParentPath;
        }

        // Performance Optimization: Hoist workspace lookups and graph access outside the 
        // render loop to minimize per-item overhead during large column renders.
        const activeFile = this.app.workspace.getActiveFile();
        const activeFilePath = activeFile?.path;
        const graph = this.plugin.indexer.getGraph();

        // Lazy Rendering Strategy: Break the synchronous rendering task into smaller 
        // batches using requestAnimationFrame. This prevents the main thread from 
        // blocking (causing UI lag) while allowing the browser to remain responsive.
        const INITIAL_BATCH_SIZE = 100; // Render first 100 items immediately for instant feedback
        const DEFERRED_BATCH_SIZE = 200; // Render remaining items in chunks per frame

        const renderBatch = (startIndex: number) => {
            const isInitial = startIndex === 0;
            const batchSize = isInitial ? INITIAL_BATCH_SIZE : DEFERRED_BATCH_SIZE;
            const endIndex = Math.min(startIndex + batchSize, nodes.length);

            for (let i = startIndex; i < endIndex; i++) {
                this.renderColumnNode(nodes[i], columnEl, depth, selectedParentPath || "", activeFilePath, graph);
            }

            // If there are more items to render, schedule the next batch in the next animation frame.
            if (endIndex < nodes.length) {
                window.requestAnimationFrame(() => renderBatch(endIndex));
            }
        };

        renderBatch(0);
    }

    private renderColumnNode(
        node: FolderNode, 
        parentEl: HTMLElement, 
        depth: number, 
        parentPath: string, 
        activeFilePath?: string, 
        graph?: FileGraph
    ) {
        const isFolder = node.isFolder && node.children.length > 0;

        const itemEl = parentEl.createDiv({ 
            cls: "abstract-folder-item",
            attr: { 'data-path': node.path }
        });
        itemEl.draggable = true;

        itemEl.addEventListener("dragstart", (e) => this.dragManager.handleDragStart(e, node, parentPath, this.multiSelectedPaths));
        itemEl.addEventListener("dragover", (e) => this.dragManager.handleDragOver(e, node));
        itemEl.addEventListener("dragleave", (e) => this.dragManager.handleDragLeave(e));
        itemEl.addEventListener("drop", (e) => {
            this.dragManager.handleDrop(e, node).catch(Logger.error);
        });

        if (isFolder) {
            itemEl.addClass("is-folder");
        } else {
            itemEl.addClass("is-file");
        }

        const selfEl = itemEl.createDiv({ cls: "abstract-folder-item-self" });

        if (activeFilePath && activeFilePath === node.path) {
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

        if (node.isFolder) {
            const iconEl = selfEl.createDiv({ cls: "abstract-folder-collapse-icon" });
            setIcon(iconEl, "chevron-right");

            iconEl.addEventListener("click", (e) => {
                e.stopPropagation();
                this.handleColumnExpand(node, depth);
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

        const parentCount = graph?.childToParents.get(node.path)?.size || 0;
        
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
