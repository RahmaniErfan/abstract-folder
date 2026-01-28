import { App, Menu, TFile } from "obsidian";
import { FolderNode } from "../types";
import { AbstractFolderPluginSettings } from "../settings";
import AbstractFolderPlugin from "../../main";
import { BatchDeleteConfirmModal, CreateAbstractChildModal, ChildFileType, DeleteConfirmModal } from './modals';
import { IconModal } from './icon-modal';
import { updateFileIcon, toggleHiddenStatus, createAbstractChildFile, deleteAbstractFile } from '../utils/file-operations';
import { FolderIndexer } from "../indexer";

export class ContextMenuHandler {
    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private plugin: AbstractFolderPlugin,
        private indexer: FolderIndexer,
        private focusFile: (path: string) => void
    ) {}

    showContextMenu(event: MouseEvent, node: FolderNode, multiSelectedPaths: Set<string>) {
        const menu = new Menu();
        menu.setUseNativeMenu(false);

        if (multiSelectedPaths.size > 1 && multiSelectedPaths.has(node.path)) {
            this.addMultiSelectItems(menu, multiSelectedPaths);
        } else {
            this.addSingleItemItems(menu, node, multiSelectedPaths);
        }

        menu.showAtPosition({ x: event.clientX, y: event.clientY });
    }

    showBackgroundMenu(event: MouseEvent) {
        const menu = new Menu();
        menu.setUseNativeMenu(false);
        this.addCreationItems(menu);
        menu.showAtPosition({ x: event.clientX, y: event.clientY });
    }

    private addMultiSelectItems(menu: Menu, multiSelectedPaths: Set<string>) {
        const selectedFiles: TFile[] = [];
        multiSelectedPaths.forEach(path => {
            const abstractFile = this.app.vault.getAbstractFileByPath(path);
            if (abstractFile instanceof TFile) {
                selectedFiles.push(abstractFile);
            }
        });

        this.app.workspace.trigger("files-menu", menu, selectedFiles, "abstract-folder-view");
        
        menu.addSeparator();
        menu.addItem((item) =>
            item
                .setTitle(`Delete ${selectedFiles.length} items`)
                .setIcon("trash")
                .onClick(() => {
                    new BatchDeleteConfirmModal(this.app, selectedFiles, (deleteChildren: boolean) => {
                        const deletePromises = selectedFiles.map(file =>
                            deleteAbstractFile(this.app, file, deleteChildren, this.indexer)
                        );
                        Promise.all(deletePromises).then(() => {
                            multiSelectedPaths.clear();
                            this.plugin.app.workspace.trigger('abstract-folder:graph-updated');
                        }).catch(console.error);
                    }).open();
                })
        );
    }

    private addSingleItemItems(menu: Menu, node: FolderNode, multiSelectedPaths: Set<string>) {
        if (!node.file) return;

        if (!multiSelectedPaths.has(node.path) && multiSelectedPaths.size > 0) {
            multiSelectedPaths.clear();
            this.plugin.app.workspace.trigger('abstract-folder:graph-updated');
        }

        // Plugin-specific actions first
        this.addCreationItems(menu, node.file);
        this.addPluginSpecificActions(menu, node.file);

        menu.addItem((item) =>
            item
            .setTitle("Delete file")
            .setIcon("trash")
            .setSection('abstract-folder')
            .onClick(() => {
                new DeleteConfirmModal(this.app, node.file!, (deleteChildren: boolean) => {
                    deleteAbstractFile(this.app, node.file!, deleteChildren, this.indexer)
                        .catch(console.error);
                }).open();
            })
        );
        menu.addSeparator();

        // Standard file actions
        this.addStandardFileActions(menu, node.file);
        menu.addSeparator();

        // Trigger file-menu after adding our primary items
        this.app.workspace.trigger("file-menu", menu, node.file, "abstract-folder-view");
    }

    private truncate(text: string): string {
        const maxLength = this.settings.maxMenuNameLength;
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    }

    private addCreationItems(menu: Menu, parentFile: TFile | null = null) {
        const parentName = parentFile ? ` in ${this.truncate(parentFile.basename)}` : "";
        menu.addItem((item) =>
            item
            .setTitle(parentFile ? `Create child note${parentName}` : "Create new root note")
            .setIcon("file-plus")
            .setSection('abstract-folder')
            .onClick(() => {
                new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
                    createAbstractChildFile(this.app, this.settings, childName, parentFile, childType, this.indexer)
                        .catch(console.error);
                }, 'note').open();
            })
        );
        
        menu.addItem((item) =>
            item
            .setTitle(parentFile ? `Create child canvas${parentName}` : "Create new root canvas")
            .setIcon("layout-dashboard")
            .setSection('abstract-folder')
            .onClick(() => {
                new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
                    createAbstractChildFile(this.app, this.settings, childName, parentFile, childType, this.indexer)
                        .catch(console.error);
                }, 'canvas').open();
            })
        );

        menu.addItem((item) =>
            item
            .setTitle(parentFile ? `Create child base${parentName}` : "Create new root base")
            .setIcon("database")
            .setSection('abstract-folder')
            .onClick(() => {
                new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
                    createAbstractChildFile(this.app, this.settings, childName, parentFile, childType, this.indexer)
                        .catch(console.error);
                }, 'base').open();
            })
        );
        
    }

    private addPluginSpecificActions(menu: Menu, file: TFile) {
        menu.addItem((item) =>
            item
                .setTitle("Focus this file")
                .setIcon("target")
                .setSection('abstract-folder')
                .onClick(() => {
                    this.focusFile?.(file.path);
                })
        );

        const fileCache = this.app.metadataCache.getFileCache(file);
        const parentProperty = fileCache?.frontmatter?.[this.settings.propertyName] as string | string[] | undefined;
        let isCurrentlyHidden = false;
        if (parentProperty) {
            const parentLinks = Array.isArray(parentProperty) ? parentProperty : [parentProperty];
            isCurrentlyHidden = parentLinks.some((p: string) => p.toLowerCase().trim() === 'hidden');
        }

        if (isCurrentlyHidden) {
            menu.addItem((item) =>
                item
                    .setTitle("Unhide abstract note")
                    .setIcon("eye")
                    .setSection('abstract-folder')
                    .onClick(() => {
                        toggleHiddenStatus(this.app, file, this.settings).catch(console.error);
                    })
            );
        } else {
            menu.addItem((item) =>
                item
                    .setTitle("Hide abstract note")
                    .setIcon("eye-off")
                    .setSection('abstract-folder')
                    .onClick(() => {
                        toggleHiddenStatus(this.app, file, this.settings).catch(console.error);
                    })
            );
        }

        menu.addItem((item) =>
            item
                .setTitle("Set/change icon")
                .setIcon("image")
                .setSection('abstract-folder')
                .onClick(() => {
                    const currentIcon = this.app.metadataCache.getFileCache(file)?.frontmatter?.icon as string | undefined;
                    new IconModal(this.app, (result) => {
                        updateFileIcon(this.app, file, result).catch(console.error);
                    }, currentIcon as string || "").open();
                })
        );

    }

    private addStandardFileActions(menu: Menu, file: TFile) {
        menu.addItem((item) =>
            item
                .setTitle("Open in new tab")
                .setIcon("file-plus")
                .onClick(() => {
                    this.app.workspace.getLeaf('tab').openFile(file).catch(console.error);
                })
        );

        menu.addItem((item) =>
            item
                .setTitle("Open to the right")
                .setIcon("separator-vertical")
                .onClick(() => {
                    this.app.workspace.getLeaf('split').openFile(file).catch(console.error);
                })
        );

        menu.addItem((item) =>
            item
                .setTitle("Open in new window")
                .setIcon("popout")
                .onClick(() => {
                    this.app.workspace.getLeaf('window').openFile(file).catch(console.error);
                })
        );
    }
}