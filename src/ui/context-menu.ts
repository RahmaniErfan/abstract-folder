import { App, Menu, TFile, Notice } from "obsidian";
import { FolderNode } from "../types";
import { AbstractFolderPluginSettings } from "../settings";
import AbstractFolderPlugin from "../../main";
import { BatchDeleteConfirmModal, CreateAbstractChildModal, ChildFileType, DeleteConfirmModal, FolderSelectionModal } from './modals';
import { IconModal } from './icon-modal';
import { updateFileIcon, toggleHiddenStatus, createAbstractChildFile, deleteAbstractFile } from '../utils/file-operations';
import { FolderIndexer } from "../indexer";
import { AbstractFolderFrontmatter } from "../types";

export class ContextMenuHandler {
    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private plugin: AbstractFolderPlugin,
        private indexer: FolderIndexer
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

        this.addFileSpecificActions(menu, node.file);

        menu.addSeparator();
        menu.addItem((item) =>
            item
            .setTitle("Delete file")
            .setIcon("trash")
            .onClick(() => {
                new DeleteConfirmModal(this.app, node.file!, (deleteChildren: boolean) => {
                    deleteAbstractFile(this.app, node.file!, deleteChildren, this.indexer)
                        .catch(console.error);
                }).open();
            })
        );
        this.app.workspace.trigger("file-menu", menu, node.file, "abstract-folder-view");
    }

    private addCreationItems(menu: Menu, parentFile: TFile | null = null) {
        menu.addItem((item) =>
            item
            .setTitle(parentFile ? "Create abstract child note" : "Create new root note")
            .setIcon("file-plus")
            .onClick(() => {
                new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
                    createAbstractChildFile(this.app, this.settings, childName, parentFile, childType)
                        .catch(console.error);
                }, 'note').open();
            })
        );
        
        menu.addItem((item) =>
            item
            .setTitle(parentFile ? "Create abstract canvas child" : "Create new root canvas")
            .setIcon("layout-dashboard")
            .onClick(() => {
                new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
                    createAbstractChildFile(this.app, this.settings, childName, parentFile, childType)
                        .catch(console.error);
                }, 'canvas').open();
            })
        );

        menu.addItem((item) =>
            item
            .setTitle(parentFile ? "Create abstract bases child" : "Create new root base")
            .setIcon("database")
            .onClick(() => {
                new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
                    createAbstractChildFile(this.app, this.settings, childName, parentFile, childType)
                        .catch(console.error);
                }, 'base').open();
            })
        );
        
    }

    private addFileSpecificActions(menu: Menu, file: TFile) {
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

        menu.addSeparator();
        
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
                .onClick(() => {
                toggleHiddenStatus(this.app, file, this.settings).catch(console.error);
                })
            );
        } else {
            menu.addItem((item) =>
            item
                .setTitle("Hide abstract note")
                .setIcon("eye-off")
                .onClick(() => {
                toggleHiddenStatus(this.app, file, this.settings).catch(console.error);
                })
            );
        }

        menu.addItem((item) =>
            item
            .setTitle("Set/change icon")
            .setIcon("image")
            .onClick(() => {
                const currentIcon = this.app.metadataCache.getFileCache(file)?.frontmatter?.icon as string | undefined;
                new IconModal(this.app, (result) => {
                    updateFileIcon(this.app, file, result).catch(console.error);
                }, currentIcon as string || "").open();
            })
        );

        menu.addItem((item) =>
            item
            .setTitle("Sync with specific folder")
            .setIcon("folder-sync")
            .onClick(() => {
                 new FolderSelectionModal(this.app, (folder) => {
                     this.app.fileManager.processFrontMatter(file, (frontmatter: AbstractFolderFrontmatter) => {
                         frontmatter[this.settings.syncPropertyName] = folder.path;
                     }).then(() => {
                        new Notice(`Synced ${file.basename} to ${folder.path}`);
                        this.indexer.rebuildGraphAndTriggerUpdate();
                     }).catch(console.error);
                 }).open();
            })
        );

        this.addCreationItems(menu, file);
    }
}