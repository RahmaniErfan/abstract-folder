import { App, Menu, setIcon, TFolder, Notice } from "obsidian";
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

export interface AbstractFolderToolbarOptions {
    containerEl: HTMLElement;
    fileCreationRoot?: string; // If provided, new files/folders are created here. If null, created at root/default.
    focusActiveFile?: () => void;
    showFocusButton?: boolean;
    showConversionButton?: boolean;
    showCollapseButton?: boolean;
    showExpandButton?: boolean;
    showViewStyleButton?: boolean;
    showSortButton?: boolean;
    showFilterButton?: boolean;
    showGroupButton?: boolean;
    showCreateNoteButton?: boolean;
    showCreateFolderButton?: boolean;
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
        const { containerEl } = this.options;
        containerEl.empty();
        containerEl.addClass("abstract-folder-toolbar");

        if (this.options.showFocusButton) {
            this.addAction("target", "Focus active file", () => this.options.focusActiveFile?.());
        }
        
        if (this.options.showConversionButton) {
            this.addAction("lucide-folder-sync", "Convert folder structure", (evt) => this.showConversionMenu(evt));
        }

        if (this.options.showViewStyleButton) {
            const btn = this.addAction("rows-2", "Switch view style", () => this.toggleViewStyle());
            this.buttons.set('viewStyle', btn);
            this.updateViewStyleToggleButton();
        }

        if (this.options.showExpandButton) {
            const btn = this.addAction("chevrons-up-down", "Expand all folders", () => {
                this.contextEngine.expandAll();
            });
            this.buttons.set('expand', btn);
        }

        if (this.options.showCollapseButton) {
            const btn = this.addAction("chevrons-down-up", "Collapse all folders", () => {
                this.contextEngine.collapseAll();
            });
            this.buttons.set('collapse', btn);
        }

        if (this.options.showSortButton) {
            this.addAction("arrow-up-down", "Sort order", (evt) => this.showSortMenu(evt));
        }

        if (this.options.showFilterButton) {
            this.addAction("filter", "Filter", (evt) => this.showFilterMenu(evt));
        }

        if (this.options.showGroupButton) {
            this.addAction("group", "Select group", (evt) => this.showGroupMenu(evt));
        }

        if (this.options.showCreateNoteButton) {
            this.addAction("file-plus", "Create new note", () => this.handleCreateNote());
        }
        
        if (this.options.showCreateFolderButton) {
            this.addAction("folder-plus", "Create new folder", () => this.handleCreateFolder());
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
        const isTreeView = this.settings.viewStyle === 'tree';
        
        const collapseBtn = this.buttons.get('collapse');
        if (collapseBtn) {
            collapseBtn.toggleClass('is-disabled', !isTreeView);
            if (!isTreeView) collapseBtn.setAttribute('aria-disabled', 'true');
            else collapseBtn.removeAttribute('aria-disabled');
        }

        const expandBtn = this.buttons.get('expand');
        if (expandBtn) {
            expandBtn.toggleClass('is-disabled', !isTreeView);
            if (!isTreeView) expandBtn.setAttribute('aria-disabled', 'true');
            else expandBtn.removeAttribute('aria-disabled');
        }

        if (this.options.showViewStyleButton) {
            this.updateViewStyleToggleButton();
        }
    }

    private toggleViewStyle() {
        // Toggle logic
        const newStyle = this.settings.viewStyle === 'tree' ? 'column' : 'tree';
        this.settings.viewStyle = newStyle;
        this.plugin.saveSettings().then(() => {
            this.plugin.app.workspace.trigger('abstract-folder:view-style-changed');
            this.updateViewStyleToggleButton();
            this.updateButtonStates();
        }).catch(Logger.error);
    }

    public updateViewStyleToggleButton(): void {
        const btn = this.buttons.get('viewStyle');
        if (!btn) return;
        
        const isColumnView = this.settings.viewStyle === 'column';
        setIcon(btn, isColumnView ? "folder-tree" : "rows-2");
        const mode = isColumnView ? "tree" : "column";
        btn.setAttribute("aria-label", `Switch to ${mode} view`);
        btn.title = `Switch to ${mode} view`;
    }

    private handleCreateNote() {
        // If we have a creation root (e.g. Space), we pre-fill or force that location.
        // For now, simpler to just use the modal but maybe we need a dedicated "Quick Create" if root is set.
        
        if (this.options.fileCreationRoot) {
            // Direct creation in the specific root
            new CreateAbstractChildModal(this.app, this.settings, (name, type) => {
                this.createFileInPath(this.options.fileCreationRoot!, name, type);
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

        // Construct full path
        // path is the folder path e.g. "Spaces/MySpace"
        // name is "My Note"
        
        const candidatePath = `${path}/${name}${extension}`;
        // We can use a simpler conflict resolution or reuse getConflictFreeName if updated to support path prefixes
        // For now, simple increment
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

    private handleCreateFolder() {
        if (this.options.fileCreationRoot) {
            new NameInputModal(this.app, "Create new folder", "Folder name", (name) => {
                 this.createFolderInPath(this.options.fileCreationRoot!, name);
             }).open();
        } else {
             new NameInputModal(this.app, "Create new folder", "Folder name", (name) => {
                 this.createFolderInPath(this.app.vault.getRoot().path, name);
             }).open();
        }
    }

    private async createFolderInPath(path: string, name: string) {
        const candidatePath = path === '/' ? name : `${path}/${name}`;
        let finalPath = candidatePath;
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(finalPath)) {
            finalPath = path === '/' ? `${name} ${counter}` : `${path}/${name} ${counter}`;
            counter++;
        }

        try {
            await this.app.vault.createFolder(finalPath);
        } catch (e) {
            new Notice(`Failed to create folder: ${e.message}`);
        }
    }

    private showSortMenu(event: MouseEvent): void {
        const menu = new Menu();
        menu.addItem(item => item.setTitle("Manage default sorting").setIcon("gear").onClick(() => {
            new ManageSortingModal(this.app, this.settings, (updated) => {
                this.plugin.settings = updated;
                this.plugin.saveSettings().then(() => {
                    let sortConfig = this.plugin.settings.defaultSort;
                    if (this.contextEngine.getState().activeGroupId) {
                        const active = this.plugin.settings.groups.find(g => g.id === this.contextEngine.getState().activeGroupId);
                        if (active && active.sort) sortConfig = active.sort;
                    }
                    this.contextEngine.setSortConfig(sortConfig);
                }).catch(Logger.error);
            }).open();
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
            new ManageFilteringModal(this.app, this.settings, (updated) => {
                this.plugin.settings = updated;
                this.plugin.saveSettings().then(() => {
                    this.plugin.app.workspace.trigger('abstract-folder:graph-updated');
                }).catch(Logger.error);
            }).open();
        }));

        menu.showAtMouseEvent(event);
    }

    private showGroupMenu(event: MouseEvent): void {
        const menu = new Menu();
        if (this.settings.groups.length === 0) {
            menu.addItem(item => item.setTitle("No groups defined").setDisabled(true));
        } else {
            this.settings.groups.forEach((group: Group) => {
                menu.addItem(item => item.setTitle(group.name)
                    .setIcon(this.settings.activeGroupId === group.id ? "check" : "group")
                    .onClick(async () => {
                        this.contextEngine.setActiveGroup(group.id);
                        await this.plugin.saveSettings();
                        if (group.sort) this.contextEngine.setSortConfig(group.sort);
                    }));
            });
            menu.addSeparator();
        }

        menu.addItem(item => item.setTitle("Manage groups").setIcon("gear").onClick(() => {
            new ManageGroupsModal(this.app, this.settings, (updatedGroups, activeGroupId) => {
                this.plugin.settings.groups = updatedGroups;
                this.plugin.settings.activeGroupId = activeGroupId;
                this.contextEngine.setActiveGroup(activeGroupId);
                this.plugin.saveSettings().catch(Logger.error);
            }, this.plugin).open();
        }));

        // Only show Clear if we are currently in a group
        if (this.contextEngine.getState().activeGroupId) {
            menu.addItem(item => item.setTitle("Clear active group").setIcon("cross").onClick(async () => {
                this.contextEngine.setActiveGroup(null);
                await this.plugin.saveSettings();
                const defaultSort = this.plugin.settings.defaultSort;
                this.contextEngine.setSortConfig(defaultSort);
            }));
        }

        menu.showAtMouseEvent(event);
    }

    private showConversionMenu(event: MouseEvent): void {
        const menu = new Menu();
        menu.addItem(item => item.setTitle("Convert physical folder to abstract folder").setIcon("folder-symlink")
            .onClick(() => this.plugin.app.commands.executeCommandById("abstract-folder:convert-folder-to-plugin")));
        menu.addItem(item => item.setTitle("Create folder structure from plugin format").setIcon("folder-plus")
            .onClick(() => this.plugin.app.commands.executeCommandById("abstract-folder:create-folders-from-plugin")));
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
