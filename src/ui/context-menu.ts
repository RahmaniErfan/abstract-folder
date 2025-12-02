import { App, Menu, TFile } from "obsidian";
import { FolderNode } from "../types";
import { AbstractFolderPluginSettings } from "../settings";
import AbstractFolderPlugin from "../../main";
import { BatchDeleteConfirmModal, CreateAbstractChildModal, RenameModal, DeleteConfirmModal, ChildFileType } from './modals';
import { IconModal } from './icon-modal';
import { updateFileIcon, toggleHiddenStatus, createAbstractChildFile } from '../file-operations';

export class ContextMenuHandler {
    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private plugin: AbstractFolderPlugin
    ) {}

    showContextMenu(event: MouseEvent, node: FolderNode, multiSelectedPaths: Set<string>) {
        const menu = new Menu();

        if (multiSelectedPaths.size > 1 && multiSelectedPaths.has(node.path)) {
            this.addMultiSelectItems(menu, multiSelectedPaths);
        } else {
            this.addSingleItemItems(menu, node, multiSelectedPaths);
        }

        menu.showAtPosition({ x: event.clientX, y: event.clientY });
    }

    showBackgroundMenu(event: MouseEvent) {
        const menu = new Menu();
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
                    new BatchDeleteConfirmModal(this.app, selectedFiles, async () => {
                        for (const file of selectedFiles) {
                            await this.app.fileManager.trashFile(file);
                        }
                        multiSelectedPaths.clear();
                        this.plugin.app.workspace.trigger('abstract-folder:graph-updated');
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

        menu.addItem((item) =>
            item
            .setTitle("Open in new tab")
            .setIcon("file-plus")
            .onClick(() => {
                this.app.workspace.getLeaf('tab').openFile(node.file!);
            })
        );

        menu.addItem((item) =>
            item
            .setTitle("Open to the right")
            .setIcon("separator-vertical")
            .onClick(() => {
                this.app.workspace.getLeaf('split').openFile(node.file!);
            })
        );

        menu.addItem((item) =>
            item
            .setTitle("Open in new window")
            .setIcon("popout")
            .onClick(() => {
                this.app.workspace.getLeaf('window').openFile(node.file!);
            })
        );

        menu.addSeparator();
        
        const fileCache = this.app.metadataCache.getFileCache(node.file);
        const parentProperty = fileCache?.frontmatter?.[this.settings.propertyName];
        let isCurrentlyHidden = false;
        if (parentProperty) {
            const parentLinks = Array.isArray(parentProperty) ? parentProperty : [parentProperty];
            isCurrentlyHidden = parentLinks.some((p: string) => p.toLowerCase().trim() === 'hidden');
        }

        if (isCurrentlyHidden) {
            menu.addItem((item) =>
            item
                .setTitle("Unhide note")
                .setIcon("eye")
                .onClick(() => {
                toggleHiddenStatus(this.app, node.file!, this.settings);
                })
            );
        } else {
            menu.addItem((item) =>
            item
                .setTitle("Hide note")
                .setIcon("eye-off")
                .onClick(() => {
                toggleHiddenStatus(this.app, node.file!, this.settings);
                })
            );
        }

        menu.addSeparator();

        this.addCreationItems(menu, node.file!);

        menu.addSeparator();
        
        menu.addItem((item) =>
            item
            .setTitle("Rename")
            .setIcon("pencil")
            .onClick(() => {
                new RenameModal(this.app, node.file!).open();
            })
        );

        menu.addItem((item) =>
            item
            .setTitle("Delete")
            .setIcon("trash")
            .onClick(() => {
                new DeleteConfirmModal(this.app, node.file!, () => {
                    this.app.fileManager.trashFile(node.file!);
                }).open();
            })
        );

        menu.addItem((item) =>
            item
            .setTitle("Set/change icon")
            .setIcon("image")
            .onClick(() => {
                const currentIcon = this.app.metadataCache.getFileCache(node.file!)?.frontmatter?.icon || "";
                new IconModal(this.app, (result) => {
                updateFileIcon(this.app, node.file!, result);
                }, currentIcon).open();
            })
        );

        this.app.workspace.trigger("file-menu", menu, node.file, "abstract-folder-view");
    }

    private addCreationItems(menu: Menu, parentFile: TFile | null = null) {
        menu.addItem((item) =>
            item
            .setTitle(parentFile ? "Create Abstract Child Note" : "Create New Root Note")
            .setIcon("file-plus")
            .onClick(() => {
                new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
                createAbstractChildFile(this.app, this.settings, childName, parentFile, childType);
                }, 'note').open();
            })
        );
        
        menu.addItem((item) =>
            item
            .setTitle(parentFile ? "Create Abstract Canvas Child" : "Create New Root Canvas")
            .setIcon("layout-dashboard")
            .onClick(() => {
                new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
                createAbstractChildFile(this.app, this.settings, childName, parentFile, childType);
                }, 'canvas').open();
            })
        );

        menu.addItem((item) =>
            item
            .setTitle(parentFile ? "Create Abstract Bases Child" : "Create New Root Base")
            .setIcon("database")
            .onClick(() => {
                new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
                createAbstractChildFile(this.app, this.settings, childName, parentFile, childType);
                }, 'base').open();
            })
        );
    }
}