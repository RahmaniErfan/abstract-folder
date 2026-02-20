import { App, Menu, setIcon, TFolder, Notice, TFile } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import type AbstractFolderPlugin from "main";
import { CreateAbstractChildModal } from "../modals";
import { createAbstractChildFile, getConflictFreeName } from "../../utils/file-operations";
import { ManageSortingModal } from "../modals/manage-sorting-modal";
import { ManageFilteringModal } from "../modals/manage-filtering-modal";
import { Group, SortBy } from "../../types";
import { ManageGroupsModal } from "../modals/manage-groups-modal";
import { Logger } from "../../utils/logger";
import { ContextEngine } from "../../core/context-engine";
import { ContentProvider } from "../../core/content-provider";

export interface AbstractFolderToolbarOptions {
    containerEl: HTMLElement;
    provider: ContentProvider;
    focusActiveFile?: () => void;
    showFocusButton?: boolean;
    showConversionButton?: boolean;
    showCollapseButton?: boolean;
    showExpandButton?: boolean;
    showSortButton?: boolean;
    showFilterButton?: boolean;
    showGroupButton?: boolean;
    showCreateNoteButton?: boolean;
    extraActions?: (container: HTMLElement) => void;
}

export class AbstractFolderToolbar {
    private buttons: Map<string, HTMLElement> = new Map();

    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private plugin: AbstractFolderPlugin, // needed for modals that require plugin instance
        private contextEngine: ContextEngine,
        private options: AbstractFolderToolbarOptions
    ) {}

    public render(): void {
        const { containerEl, provider } = this.options;
        containerEl.empty();
        containerEl.addClass("abstract-folder-toolbar");
        
        Logger.debug("[Abstract Folder] Toolbar: Rendering with options", this.options);

        if (this.options.showFocusButton) {
            this.addAction("target", "Focus active file", () => this.options.focusActiveFile?.());
        }
        
        if (this.options.showConversionButton) {
            this.addAction("lucide-folder-sync", "Convert folder structure", (evt) => this.showConversionMenu(evt));
        }
        
        if (this.options.showExpandButton) {
            const btn = this.addAction("chevrons-up-down", "Expand all", () => {
                this.contextEngine.expandAll();
            });
            this.buttons.set('expand', btn);
        }

        if (this.options.showCollapseButton) {
            const btn = this.addAction("chevrons-down-up", "Collapse all", () => {
                this.contextEngine.collapseAll();
            });
            this.buttons.set('collapse', btn);
        }

        if (this.options.showSortButton && provider.supportsSorting()) {
            this.addAction("arrow-up-down", "Sort order", (evt) => this.showSortMenu(evt));
        }

        if (this.options.showFilterButton && provider.supportsFiltering()) {
            this.addAction("filter", "Filter", (evt) => this.showFilterMenu(evt));
        }

        if (this.options.showGroupButton && provider.supportsGroups()) {
            this.addAction("group", "Select group", (evt) => this.showGroupMenu(evt));
        }

        if (this.options.showCreateNoteButton) {
            this.addAction("file-plus", "Create new note", () => this.handleCreateNote());
        }
        
        if (this.options.extraActions) {
            this.options.extraActions(containerEl);
        }

        this.updateButtonStates();
    }

    private addAction(icon: string, title: string, onclick: (evt: MouseEvent) => void): HTMLElement {
        const actionEl = this.options.containerEl.createDiv({
            cls: "abstract-folder-toolbar-action clickable-icon",
            attr: { "aria-label": title, "title": title }
        });
        setIcon(actionEl, icon);
        actionEl.addEventListener("click", (evt: MouseEvent) => {
            evt.preventDefault();
            evt.stopPropagation();
            onclick(evt);
        });
        return actionEl;
    }

    public updateButtonStates(): void {
        if (this.options.showExpandButton) {
            this.updateExpandButtonState();
        }
    }

    private updateExpandButtonState() {
        // Logic if needed
    }

    private handleCreateNote() {
        const creationRoot = this.options.provider.getCreationRoot();
        
        if (creationRoot) {
            // Direct creation in the specific root
            new CreateAbstractChildModal(this.app, this.settings, (name, type) => {
                this.createFileInPath(creationRoot, name, type);
            }, 'note').open();
        } else {
            // Standard abstract creation
            new CreateAbstractChildModal(this.app, this.settings, (name, type) => {
                createAbstractChildFile(this.app, this.settings, name, null, type, this.plugin.graphEngine).catch(Logger.error);
            }, 'note').open();
        }
    }

    private async createFileInPath(path: string, name: string, type: 'note' | 'canvas' | 'base') {
        let extension = '.md';
        let content = '';
        if (type === 'canvas') {
            extension = '.canvas';
            content = '{"nodes":[], "edges":[]}';
        } else if (type === 'base') {
            extension = '.base';
            content = '{}';
        }

        const candidatePath = `${path}/${name}${extension}`;
        let finalPath = candidatePath;
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(finalPath)) {
            finalPath = `${path}/${name} ${counter}${extension}`;
            counter++;
        }

        try {
            const newFile = await this.app.vault.create(finalPath, content);
            this.app.workspace.getLeaf(false).openFile(newFile);
        } catch (e) {
            new Notice(`Failed to create file: ${e.message}`);
        }
    }

    private showSortMenu(event: MouseEvent): void {
        const menu = new Menu();
        menu.addItem(item => item.setTitle("Manage default sorting").setIcon("gear").onClick(() => {
            new ManageSortingModal(this.app, this.contextEngine, this.plugin).open();
        }));
        menu.addSeparator();
        const currentSort = this.contextEngine.getState().sortConfig;
        const addSortItem = (title: string, icon: string, sortBy: SortBy, sortOrder: 'asc' | 'desc') => {
            menu.addItem(item => item.setTitle(title)
                .setIcon(currentSort.sortBy === sortBy && currentSort.sortOrder === sortOrder ? "check" : icon)
                .onClick(() => this.contextEngine.setSortConfig({ sortBy, sortOrder })));
        };
        addSortItem("Sort by name (ascending)", "sort-asc", 'name', 'asc');
        addSortItem("Sort by name (descending)", "sort-desc", 'name', 'desc');
        menu.addSeparator();
        addSortItem("Sort by modified (old to new)", "sort-asc", 'mtime', 'asc');
        addSortItem("Sort by modified (new to old)", "sort-desc", 'mtime', 'desc');
        menu.addSeparator();
        addSortItem("Sort by created (old to new)", "sort-asc", 'ctime', 'asc');
        addSortItem("Sort by created (new to old)", "sort-desc", 'ctime', 'desc');
        menu.addSeparator();
        addSortItem("Sort by thermal (most to least)", "flame", 'thermal', 'desc');
        addSortItem("Sort by thermal (least to most)", "flame", 'thermal', 'asc');
        menu.addSeparator();
        addSortItem("Sort by stale rot (most to least)", "skull", 'rot', 'desc');
        addSortItem("Sort by stale rot (least to most)", "skull", 'rot', 'asc');
        menu.addSeparator();
        addSortItem("Sort by gravity (heaviest to lightest)", "weight", 'gravity', 'desc');
        addSortItem("Sort by gravity (lightest to heaviest)", "weight", 'gravity', 'asc');
        menu.showAtMouseEvent(event);
    }

    private showFilterMenu(event: MouseEvent): void {
        const menu = new Menu();
        menu.addItem(item => item.setTitle("Manage default filtering").setIcon("gear").onClick(() => {
            new ManageFilteringModal(this.app, this.contextEngine, this.plugin).open();
        }));

        menu.showAtMouseEvent(event);
    }

    private showGroupMenu(event: MouseEvent): void {
        const menu = new Menu();
        const groups = this.contextEngine.getGroups();
        if (groups.length === 0) {
            menu.addItem(item => item.setTitle("No groups defined").setDisabled(true));
        } else {
            groups.forEach((group: Group) => {
                const isActive = this.contextEngine.getState().activeGroupId === group.id;
                menu.addItem(item => item.setTitle(group.name)
                    .setIcon(isActive ? "check" : "group")
                    .onClick(async () => {
                         // Toggle or Set
                         if (isActive) {
                             this.contextEngine.setActiveGroup(null);
                         } else {
                             this.contextEngine.setActiveGroup(group.id);
                             if (group.sort) this.contextEngine.setSortConfig(group.sort);
                         }
                    }));
            });
            menu.addSeparator();
        }

        menu.addItem(item => item.setTitle("Manage groups").setIcon("gear").onClick(() => {
            new ManageGroupsModal(this.app, this.contextEngine, this.plugin).open();
        }));

        // Only show Clear if we are currently in a group
        if (this.contextEngine.getState().activeGroupId) {
            menu.addItem(item => item.setTitle("Clear active group").setIcon("cross").onClick(async () => {
                this.contextEngine.setActiveGroup(null);
                
                // Revert to scope default sort
                const scope = this.plugin.settings.scopes[this.contextEngine.getScope()];
                if (scope && scope.sort) {
                    this.contextEngine.setSortConfig(scope.sort);
                } else {
                    this.contextEngine.setSortConfig({ sortBy: 'name', sortOrder: 'asc' });
                }
            }));
        }

        menu.showAtMouseEvent(event);
    }

    private showConversionMenu(event: MouseEvent): void {
        const menu = new Menu();
        
        menu.addItem(item => item.setTitle("Convert folders to abstract format").setIcon("folder-symlink")
            .onClick(() => {
                const scope = this.contextEngine.getScope();
                const rootPath = this.options.provider.getCreationRoot();
                if (scope !== 'global' && rootPath) {
                    const folder = this.plugin.app.vault.getAbstractFileByPath(rootPath);
                    if (folder instanceof TFolder) {
                        import("../../utils/conversion").then(({ convertFoldersToPluginFormat }) => {
                            import("../modals").then(({ ConversionOptionsModal }) => {
                                new ConversionOptionsModal(this.plugin.app, folder, (options) => {
                                    convertFoldersToPluginFormat(this.plugin.app, this.settings, folder, options)
                                        .catch(console.error);
                                }).open();
                            });
                        });
                        return;
                    }
                }
                this.plugin.app.commands.executeCommandById("abstract-folder:convert-folder-to-plugin");
            }));
            
        menu.addItem(item => item.setTitle("Convert abstract format to folders").setIcon("folder-plus")
            .onClick(() => {
                const scope = this.contextEngine.getScope();
                const rootPath = this.options.provider.getCreationRoot();
                if (scope !== 'global' && rootPath) {
                    const file = this.plugin.app.vault.getAbstractFileByPath(rootPath);
                    if (file) {
                        // For "from plugin", it asks for DestinationPicker to know WHERE to export to.
                        import("../modals").then(({ DestinationPickerModal, NewFolderNameModal, SimulationModal }) => {
                            import("../../utils/conversion").then(({ generateFolderStructurePlan, executeFolderGeneration }) => {
                                new DestinationPickerModal(this.plugin.app, (parentFolder: TFolder) => {
                                    new NewFolderNameModal(this.plugin.app, parentFolder, (destinationPath: string, placeIndexFileInside: boolean) => {
                                        if (!this.settings.excludedPaths.includes(destinationPath)) {
                                            this.settings.excludedPaths.push(destinationPath);
                                            this.plugin.saveSettings().catch(console.error);
                                        }
                                        const rootScopeFile = file instanceof TFile ? file : undefined;
                                        // If it is a folder, we cannot use it directly as rootScope. In that case, we might fall back to global vault export,
                                        // or ideally, we'd find the index file. Since we don't have the index file here easily, we pass undefined,
                                        // but that would trigger a global export. A robust fix would find the TFile representing the folder.
                                        // For now, if file is not a TFile, we will pass undefined.
                                        const plan = generateFolderStructurePlan(this.plugin.app, this.settings, this.plugin.graphEngine, destinationPath, placeIndexFileInside, rootScopeFile);
                                        new SimulationModal(this.plugin.app, plan.conflicts, () => {
                                            executeFolderGeneration(this.plugin.app, plan).catch(console.error);
                                        }).open();
                                    }).open();
                                }).open();
                            });
                        });
                        return;
                    }
                }
                this.plugin.app.commands.executeCommandById("abstract-folder:create-folders-from-plugin");
            }));
            
        menu.showAtMouseEvent(event);
    }
}

import { Modal, Setting } from "obsidian";

class NameInputModal extends Modal {
    private result: string = "";
    constructor(app: App, private title: string, private placeholder: string, private onSubmit: (result: string) => void) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: this.title });
        
        const input = new Setting(contentEl)
            .addText(text => text
                .setPlaceholder(this.placeholder)
                .onChange(value => this.result = value));

        // Focus input
        input.controlEl.querySelector("input")?.focus();
        input.controlEl.querySelector("input")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                this.submit();
            }
        });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText("Create")
                .setCta()
                .onClick(() => this.submit()));
    }

    submit() {
        if (this.result.trim()) {
            this.onSubmit(this.result);
            this.close();
        } else {
            new Notice("Name cannot be empty");
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
