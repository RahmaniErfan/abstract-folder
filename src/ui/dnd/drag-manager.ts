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

    constructor(app: App, settings: AbstractFolderPluginSettings, indexer: FolderIndexer) {
        this.app = app;
        this.settings = settings;
        this.indexer = indexer;
    }

    public handleDragStart(event: DragEvent, node: FolderNode, parentPath: string, multiSelectedPaths: Set<string>) {
        if (!event.dataTransfer) return;

        event.stopPropagation(); // Prevent bubbling to parent folder items

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

    public handleDragOver(event: DragEvent, targetNode: FolderNode) {
        if (!this.dragData) {
            console.log("DragManager: handleDragOver - No dragData, returning.");
            return;
        }

        const targetEl = event.currentTarget as HTMLElement;
        let isValid = true;

        console.log(`DragManager: handleDragOver - Source Paths: ${this.dragData.sourcePaths}, Target Node Path: ${targetNode.path}`);

        // Validation 1: Self drop
        if (this.dragData.sourcePaths.includes(targetNode.path)) {
            isValid = false;
            console.log("DragManager: handleDragOver - Validation 1 failed: Self-drop.");
        }

        // Validation 2: Non-MD target
        if (isValid && targetNode.file && targetNode.file.extension !== 'md') {
            isValid = false;
            console.log(`DragManager: handleDragOver - Validation 2 failed: Non-Markdown target (${targetNode.file.extension}).`);
        }

        // Validation 3: Circular dependency
        if (isValid) {
            for (const sourcePath of this.dragData.sourcePaths) {
                if (this.isDescendant(sourcePath, targetNode.path)) {
                    isValid = false;
                    console.log(`DragManager: handleDragOver - Validation 3 failed: Circular dependency (${sourcePath} is ancestor of ${targetNode.path}).`);
                    break;
                }
            }
        }

        if (isValid) {
            event.preventDefault(); // Necessary to allow dropping
            event.dataTransfer!.dropEffect = "move";
            targetEl.addClass("abstract-folder-drag-over");
            targetEl.removeClass("abstract-folder-drag-invalid");
            console.log("DragManager: handleDragOver - Drop is valid.");
        } else {
            // Show invalid visual feedback
            event.preventDefault(); // Allow processing to show feedback
            event.dataTransfer!.dropEffect = "none";
            targetEl.addClass("abstract-folder-drag-invalid");
            targetEl.removeClass("abstract-folder-drag-over");
            console.log("DragManager: handleDragOver - Drop is invalid.");
        }
    }

    public handleDragLeave(event: DragEvent) {
        const targetEl = event.currentTarget as HTMLElement;
        targetEl.removeClass("abstract-folder-drag-over");
        targetEl.removeClass("abstract-folder-drag-invalid");
    }

    public async handleDrop(event: DragEvent, targetNode: FolderNode) {
        const targetEl = event.currentTarget as HTMLElement;
        targetEl.removeClass("abstract-folder-drag-over");
        targetEl.removeClass("abstract-folder-drag-invalid");

        if (!this.dragData) return;

        event.preventDefault();
        event.stopPropagation();

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
            await moveFiles(this.app, this.settings, filesToMove, targetPath, sourceParentPath, this.indexer);
        }

        // Cleanup
        this.dragData = null;
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