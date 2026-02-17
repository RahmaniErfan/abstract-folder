import { Logger } from "../utils/logger";
import { App, Menu, TFile, TFolder, TAbstractFile } from "obsidian";
import { AbstractFolderPluginSettings } from "../settings";
import AbstractFolderPlugin from "../../main";
import { AbstractNode } from "../core/tree-builder";
import { BatchDeleteConfirmModal, CreateAbstractChildModal, ChildFileType, DeleteConfirmModal, RenameModal } from './modals';
import { IconModal } from './icon-modal';
import { updateFileIcon, toggleHiddenStatus, createAbstractChildFile, deleteAbstractFile } from '../utils/file-operations';
import { IGraphEngine } from "../core/graph-engine";

export class ContextMenuHandler {
    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private plugin: AbstractFolderPlugin,
        private indexer: IGraphEngine,
        private focusFile?: (path: string) => void
    ) {}

    /**
     * Shows a context menu for a node in the V2 Virtual Viewport.
     */
    showV2ContextMenu(event: MouseEvent, node: AbstractNode, selection: Set<string>, items: AbstractNode[]) {
        event.preventDefault();

        let activeSelection = selection;

        // 1. Ensure the right-clicked node is selected. 
        // If not, it becomes the ONLY selection (standard explorer behavior).
        if (!selection.has(node.uri)) {
            this.plugin.contextEngine.select(node.uri, { multi: false });
            activeSelection = this.plugin.contextEngine.getState().selectedURIs;
        }

        // 2. Map URIs to physical paths for the context menu handler
        const selectedPhysicalPaths = new Set<string>();
        activeSelection.forEach(uri => {
            const item = items.find(i => i.uri === uri);
            if (item) selectedPhysicalPaths.add(item.id);
        });

        // Ensure the current node is included (fallback for missing items mapping)
        selectedPhysicalPaths.add(node.id);

        const menu = new Menu();
        menu.setUseNativeMenu(false);

        if (selectedPhysicalPaths.size > 1 && selectedPhysicalPaths.has(node.id)) {
            this.addMultiSelectItems(menu, selectedPhysicalPaths);
        } else {
            this.addSingleItemItems(menu, node.id, selectedPhysicalPaths);
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
        const selectedFolders: TFolder[] = [];

        multiSelectedPaths.forEach(path => {
            const abstractFile = this.app.vault.getAbstractFileByPath(path);
            if (abstractFile instanceof TFile) {
                selectedFiles.push(abstractFile);
            } else if (abstractFile instanceof TFolder) {
                selectedFolders.push(abstractFile);
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
                        }).catch(Logger.error);
                    }).open();
                })
        );
    }

    private addSingleItemItems(menu: Menu, path: string, multiSelectedPaths: Set<string>) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file || !(file instanceof TAbstractFile)) return;

        if (!multiSelectedPaths.has(path) && multiSelectedPaths.size > 0) {
            multiSelectedPaths.clear();
            this.plugin.app.workspace.trigger('abstract-folder:graph-updated');
        }

        // Plugin-specific actions first
        if (file instanceof TFile) {
            this.addCreationItems(menu, file);
            this.addPluginSpecificActions(menu, file);
        } else if (file instanceof TFolder) {
            this.addCreationItems(menu, null); // Creation in a folder is like creation in root for now, or we could support it better
        }

        menu.addItem((item) =>
            item
            .setTitle("Rename")
            .setIcon("pencil")
            .setSection('abstract-folder')
            .onClick(() => {
                new RenameModal(this.app, file).open();
            })
        );

        menu.addItem((item) =>
            item
            .setTitle(file instanceof TFolder ? "Delete folder" : "Delete file")
            .setIcon("trash")
            .setSection('abstract-folder')
            .onClick(() => {
                if (file instanceof TFile) {
                    new DeleteConfirmModal(this.app, file, (deleteChildren: boolean) => {
                        deleteAbstractFile(this.app, file, deleteChildren, this.indexer)
                            .catch(Logger.error);
                    }).open();
                } else if (file instanceof TFolder) {
                    // Folders are always deleted recursively in standard Obsidian, 
                    // but we can just use the standard notice/modal if we want.
                    // For now, let's just use the vault delete if it's a folder.
                    void this.app.vault.trash(file, true);
                }
            })
        );
        menu.addSeparator();

        menu.addSeparator();

        // Standard file actions
        if (file instanceof TFile) {
            this.addStandardFileActions(menu, file);
            menu.addSeparator();
            // Trigger file-menu after adding our primary items
            this.app.workspace.trigger("file-menu", menu, file, "abstract-folder-view");
        }
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
                    createAbstractChildFile(this.app, this.settings, childName, parentFile, childType, this.indexer, this.plugin.contextEngine)
                        .catch(Logger.error);
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
                    createAbstractChildFile(this.app, this.settings, childName, parentFile, childType, this.indexer, this.plugin.contextEngine)
                        .catch(Logger.error);
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
                    createAbstractChildFile(this.app, this.settings, childName, parentFile, childType, this.indexer, this.plugin.contextEngine)
                        .catch(Logger.error);
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
        
        let isCurrentlyHidden = false;
        for (const prop of this.settings.parentPropertyNames) {
            const val = fileCache?.frontmatter?.[prop] as string | string[] | undefined;
            if (val) {
                const parentLinks = Array.isArray(val) ? val : [val];
                if (parentLinks.some((p: string) => typeof p === 'string' && p.toLowerCase().trim() === 'hidden')) {
                    isCurrentlyHidden = true;
                    break;
                }
            }
        }

        if (isCurrentlyHidden) {
            menu.addItem((item) =>
                item
                    .setTitle("Unhide abstract note")
                    .setIcon("eye")
                    .setSection('abstract-folder')
                    .onClick(() => {
                        toggleHiddenStatus(this.app, file, this.settings).catch(Logger.error);
                    })
            );
        } else {
            menu.addItem((item) =>
                item
                    .setTitle("Hide abstract note")
                    .setIcon("eye-off")
                    .setSection('abstract-folder')
                    .onClick(() => {
                        toggleHiddenStatus(this.app, file, this.settings).catch(Logger.error);
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
                        updateFileIcon(this.app, file, result).catch(Logger.error);
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
                    this.app.workspace.getLeaf('tab').openFile(file).catch(Logger.error);
                })
        );

        menu.addItem((item) =>
            item
                .setTitle("Open to the right")
                .setIcon("separator-vertical")
                .onClick(() => {
                    this.app.workspace.getLeaf('split').openFile(file).catch(Logger.error);
                })
        );

        menu.addItem((item) =>
            item
                .setTitle("Open in new window")
                .setIcon("popout")
                .onClick(() => {
                    this.app.workspace.getLeaf('window').openFile(file).catch(Logger.error);
                })
        );
    }
}
