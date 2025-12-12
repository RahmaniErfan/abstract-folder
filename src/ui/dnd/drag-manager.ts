import { App, TFile } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import { moveFiles } from "../../utils/file-operations";
import { FolderNode } from "../../types";

export interface DragData {
    sourcePaths: string[];
    sourceParentPath: string;
}

export class DragManager {
    private app: App;
    private settings: AbstractFolderPluginSettings;
    private dragData: DragData | null = null;

    constructor(app: App, settings: AbstractFolderPluginSettings) {
        this.app = app;
        this.settings = settings;
    }

    public handleDragStart(event: DragEvent, node: FolderNode, parentPath: string, multiSelectedPaths: Set<string>) {
        if (!event.dataTransfer) return;

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
        if (!this.dragData) return;
        
        // Prevent dropping on itself or its children (for folders) is handled by logic,
        // but simple self-check here:
        if (this.dragData.sourcePaths.includes(targetNode.path)) {
            return;
        }

        // strict reparenting: target must be MD or virtual (null file)
        // Non-markdown files cannot be parents
        if (targetNode.file && targetNode.file.extension !== 'md') {
            return;
        }

        // Only allow dropping on folders (files that act as folders) or the hidden root
        // If targetNode is a file, we can drop ON it if it's meant to become a parent (which implies it's a folder in abstract terms)
        // OR if we are reordering (future). For now, strict reparenting.
        
        event.preventDefault(); // Necessary to allow dropping
        event.dataTransfer!.dropEffect = "move";
        
        // Visual feedback could be handled here or via CSS on the target element
        const targetEl = event.currentTarget as HTMLElement;
        targetEl.addClass("abstract-folder-drag-over");
    }

    public handleDragLeave(event: DragEvent) {
        const targetEl = event.currentTarget as HTMLElement;
        targetEl.removeClass("abstract-folder-drag-over");
    }

    public async handleDrop(event: DragEvent, targetNode: FolderNode) {
        const targetEl = event.currentTarget as HTMLElement;
        targetEl.removeClass("abstract-folder-drag-over");

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
            await moveFiles(this.app, this.settings, filesToMove, targetPath, sourceParentPath);
        }

        // Cleanup
        this.dragData = null;
    }
}