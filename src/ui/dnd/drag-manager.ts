import { App, TFile } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import { moveFiles } from "../../utils/file-operations";
import { FolderNode } from "../../types";
import { FolderIndexer } from "../../indexer";

export interface DragData {
    sourcePaths: string[];
    sourceParentPath: string;
}

export class DragManager {
    private app: App;
    private settings: AbstractFolderPluginSettings;
    private indexer: FolderIndexer;
    private dragData: DragData | null = null;
    private currentDragTarget: HTMLElement | null = null;

    constructor(app: App, settings: AbstractFolderPluginSettings, indexer: FolderIndexer) {
        this.app = app;
        this.settings = settings;
        this.indexer = indexer;
    }

    public handleDragStart(event: DragEvent, node: FolderNode, parentPath: string, multiSelectedPaths: Set<string>) {
        if (!event.dataTransfer) return;

        event.stopPropagation(); // Prevent bubbling to parent folder items

        // Attach dragend listener to cleanup if drop doesn't fire (e.g. invalid drop target)
        const el = event.currentTarget as HTMLElement;
        el.addEventListener("dragend", this.handleDragEnd.bind(this), { once: true });

        const sourcePaths = multiSelectedPaths.has(node.path)
            ? Array.from(multiSelectedPaths)
            : [node.path];

        this.dragData = {
            sourcePaths: sourcePaths,
            sourceParentPath: parentPath
        };

        // Set drag image/effect
        event.dataTransfer.effectAllowed = "move";
        
        // We can put the first path in text/plain for external apps, though mostly internal
        event.dataTransfer.setData("text/plain", node.path);
        
        // Add a custom class to the ghost image if needed, or just let browser handle it
        const dragIcon = document.body.createDiv({
            cls: "abstract-folder-ghost-drag-image",
            text: `Moving ${sourcePaths.length} item(s)`
        });
        event.dataTransfer.setDragImage(dragIcon, 0, 0);
        setTimeout(() => dragIcon.remove(), 0);
    }

    public handleDragEnd(event: DragEvent) {
        this.cleanup();
    }

    private cleanup() {
        if (this.currentDragTarget) {
            this.currentDragTarget.removeClass("abstract-folder-drag-over");
            this.currentDragTarget.removeClass("abstract-folder-drag-invalid");
            this.currentDragTarget = null;
        }
        this.dragData = null;
    }

    public handleDragOver(event: DragEvent, targetNode: FolderNode) {
        if (!this.dragData) {
            return;
        }

        event.stopPropagation(); // Ensure we only highlight the specific item dragged over

        const targetEl = event.currentTarget as HTMLElement;
        
        // Track current target for cleanup
        if (this.currentDragTarget && this.currentDragTarget !== targetEl) {
            this.currentDragTarget.removeClass("abstract-folder-drag-over");
            this.currentDragTarget.removeClass("abstract-folder-drag-invalid");
        }
        this.currentDragTarget = targetEl;

        let isValid = true;

        // Validation 1: Self drop
        if (this.dragData.sourcePaths.includes(targetNode.path)) {
            isValid = false;
        }

        // Validation 2: Non-MD target
        if (isValid && targetNode.file && targetNode.file.extension !== 'md') {
            isValid = false;
        }

        // Validation 3: Circular dependency
        if (isValid) {
            for (const sourcePath of this.dragData.sourcePaths) {
                if (this.isDescendant(sourcePath, targetNode.path)) {
                    isValid = false;
                    break;
                }
            }
        }

        if (isValid) {
            event.preventDefault(); // Necessary to allow dropping
            event.dataTransfer!.dropEffect = "move";
            targetEl.addClass("abstract-folder-drag-over");
            targetEl.removeClass("abstract-folder-drag-invalid");
        } else {
            // Show invalid visual feedback
            event.preventDefault(); // Allow processing to show feedback
            event.dataTransfer!.dropEffect = "none";
            targetEl.addClass("abstract-folder-drag-invalid");
            targetEl.removeClass("abstract-folder-drag-over");
        }
    }

    public handleDragLeave(event: DragEvent) {
        const targetEl = event.currentTarget as HTMLElement;
        targetEl.removeClass("abstract-folder-drag-over");
        targetEl.removeClass("abstract-folder-drag-invalid");
        
        if (this.currentDragTarget === targetEl) {
            this.currentDragTarget = null;
        }
    }

    public async handleDrop(event: DragEvent, targetNode: FolderNode) {
        const targetEl = event.currentTarget as HTMLElement;
        targetEl.removeClass("abstract-folder-drag-over");
        targetEl.removeClass("abstract-folder-drag-invalid");
        this.currentDragTarget = null;

        if (!this.dragData) return;

        event.preventDefault();
        event.stopPropagation();

        try {
            const { sourcePaths, sourceParentPath } = this.dragData;
            const targetPath = targetNode.path;

            // Validation: Don't drop into self
            if (sourcePaths.includes(targetPath)) return;
            
            // Validation: Don't drop into immediate parent (no-op)
            if (targetPath === sourceParentPath) return;

            // Validation: Target must be MD or virtual
            if (targetNode.file && targetNode.file.extension !== 'md') {
                return;
            }

            const filesToMove: TFile[] = [];
            for (const path of sourcePaths) {
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    filesToMove.push(file);
                }
            }

            if (filesToMove.length > 0) {
                await moveFiles(this.app, this.settings, filesToMove, targetPath, sourceParentPath);
            }
        } finally {
            // Ensure cleanup happens even if early returns occur
            this.dragData = null;
        }
    }

    private isDescendant(potentialAncestorPath: string, potentialDescendantPath: string): boolean {
        // Simple BFS to check if potentialDescendantPath is reachable from potentialAncestorPath
        // using the graph in Indexer
        
        if (potentialAncestorPath === potentialDescendantPath) return true;

        const graph = this.indexer.getGraph();
        const children = graph.parentToChildren[potentialAncestorPath];

        if (!children) return false;

        if (children.has(potentialDescendantPath)) return true;

        for (const childPath of children) {
            if (this.isDescendant(childPath, potentialDescendantPath)) {
                return true;
            }
        }

        return false;
    }
}