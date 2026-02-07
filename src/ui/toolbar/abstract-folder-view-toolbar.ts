import { App, Menu, setIcon } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import AbstractFolderPlugin from "../../../main";
import { ViewState } from "../view-state";
import { CreateAbstractChildModal } from "../modals";
import { createAbstractChildFile } from "../../utils/file-operations";
import { ManageSortingModal } from "../modals/manage-sorting-modal";
import { ManageFilteringModal } from "../modals/manage-filtering-modal";
import { Group, SortBy } from "../../types";
import { ManageGroupsModal } from "../modals/manage-groups-modal";
import { Logger } from "../../utils/logger";

export class AbstractFolderViewToolbar {
    private viewStyleToggleAction: HTMLElement | undefined;
    private expandAllAction: HTMLElement | undefined;
    private collapseAllAction: HTMLElement | undefined;

    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private plugin: AbstractFolderPlugin,
        private viewState: ViewState,
        private containerEl: HTMLElement,
        private renderView: () => void,
        private expandAllView: () => void,
        private collapseAllView: () => void,
        private toggleSearch: () => void,
        private focusSearch: () => void,
        private focusActiveFile: () => void,
    ) {}

    private addAction(icon: string, title: string, onclick: (evt: MouseEvent) => void): HTMLElement {
        const actionEl = this.containerEl.createDiv({
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

    public setupToolbarActions(): void {
        this.containerEl.empty();
        this.containerEl.addClass("abstract-folder-toolbar");
        
        // Clear references before rebuilding
        this.viewStyleToggleAction = undefined;
        this.expandAllAction = undefined;
        this.collapseAllAction = undefined;

        if (this.settings.showViewStyleToggle) {
            this.viewStyleToggleAction = this.addAction("list", "Switch view style", () => this.viewState.toggleViewStyle());
        }
        if (this.settings.showFocusActiveFileButton) {
            this.addAction("target", "Focus active file", () => this.focusActiveFile?.());
        }
        if (this.settings.showConversionButton) {
            this.addAction("lucide-folder-sync", "Convert folder structure", (evt) => this.showConversionMenu(evt));
        }
        if (this.settings.showCollapseAllButton) {
            this.collapseAllAction = this.addAction("chevrons-down-up", "Collapse all folders", () => {
                Logger.debug("AbstractFolderViewToolbar: collapse all clicked");
                this.collapseAllView();
            });
        }
        if (this.settings.showExpandAllButton) {
            this.expandAllAction = this.addAction("chevrons-up-down", "Expand all folders", () => {
                Logger.debug("AbstractFolderViewToolbar: expand all clicked");
                this.expandAllView();
            });
        }
        if (this.settings.showSortButton) {
            this.addAction("arrow-up-down", "Sort order", (evt) => this.showSortMenu(evt));
        }
        if (this.settings.showFilterButton) {
            this.addAction("filter", "Filter", (evt) => this.showFilterMenu(evt));
        }
        if (this.settings.showGroupButton) {
            this.addAction("group", "Select group", (evt) => this.showGroupMenu(evt));
        }
        if (this.settings.showCreateNoteButton) {
            this.addAction("file-plus", "Create new root note", () => {
                new CreateAbstractChildModal(this.app, this.settings, (name, type) => {
                    createAbstractChildFile(this.app, this.settings, name, null, type, this.plugin.indexer).catch(Logger.error);
                }, 'note').open();
            });
        }

        this.updateViewStyleToggleButton();
        this.updateButtonStates();
    }

    public updateButtonStates(): void {
        const isTreeView = this.settings.viewStyle === 'tree';
        if (this.expandAllAction) {
            this.expandAllAction.ariaDisabled = String(!isTreeView);
            this.expandAllAction.toggleClass('is-disabled', !isTreeView);
        }
        if (this.collapseAllAction) {
            this.collapseAllAction.ariaDisabled = String(!isTreeView);
            this.collapseAllAction.toggleClass('is-disabled', !isTreeView);
        }
    }

    public updateViewStyleToggleButton(): void {
        if (!this.viewStyleToggleAction) return;
        const isColumnView = this.settings.viewStyle === 'column';
        setIcon(this.viewStyleToggleAction, isColumnView ? "folder-tree" : "rows-2");
        this.viewStyleToggleAction.ariaLabel = isColumnView ? "Switch to tree view" : "Switch to column view";
        this.viewStyleToggleAction.title = isColumnView ? "Switch to tree view" : "Switch to column view";
    }

    private showSortMenu(event: MouseEvent): void {
        const menu = new Menu();
        menu.addItem(item => item.setTitle("Manage default sorting").setIcon("gear").onClick(() => {
            new ManageSortingModal(this.app, this.settings, (updated) => {
                this.plugin.settings = updated;
                this.plugin.saveSettings().then(() => {
                    let sortConfig = this.plugin.settings.defaultSort;
                    if (this.plugin.settings.activeGroupId) {
                        const active = this.plugin.settings.groups.find(g => g.id === this.plugin.settings.activeGroupId);
                        if (active && active.sort) sortConfig = active.sort;
                    }
                    this.viewState.setSort(sortConfig.sortBy, sortConfig.sortOrder);
                }).catch(Logger.error);
            }).open();
        }));
        menu.addSeparator();
        const addSortItem = (title: string, icon: string, sortBy: SortBy, sortOrder: 'asc' | 'desc') => {
            menu.addItem(item => item.setTitle(title)
                .setIcon(this.viewState.sortBy === sortBy && this.viewState.sortOrder === sortOrder ? "check" : icon)
                .onClick(() => this.viewState.setSort(sortBy, sortOrder)));
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
                    let filterConfig = this.plugin.settings.defaultFilter;
                    if (this.plugin.settings.activeGroupId) {
                        const active = this.plugin.settings.groups.find(g => g.id === this.plugin.settings.activeGroupId);
                        if (active && active.filter) filterConfig = active.filter;
                    }
                    this.viewState.setFilter(filterConfig.excludeExtensions);
                }).catch(Logger.error);
            }).open();
        }));
        menu.addSeparator();

        const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
        const isHidingImages = imageExtensions.every(ext => this.viewState.excludeExtensions.includes(ext));
        menu.addItem(item => item.setTitle(isHidingImages ? "Show image files" : "Hide image files")
            .setIcon(isHidingImages ? "check" : "image")
            .onClick(() => {
                const current = new Set(this.viewState.excludeExtensions);
                if (isHidingImages) imageExtensions.forEach(ext => current.delete(ext));
                else imageExtensions.forEach(ext => current.add(ext));
                this.viewState.setFilter(Array.from(current));
            }));

        const isHidingCanvas = this.viewState.excludeExtensions.includes('canvas');
        menu.addItem(item => item.setTitle(isHidingCanvas ? "Show canvas files" : "Hide canvas files")
            .setIcon(isHidingCanvas ? "check" : "layout-dashboard")
            .onClick(() => {
                const current = new Set(this.viewState.excludeExtensions);
                if (isHidingCanvas) current.delete('canvas');
                else current.add('canvas');
                this.viewState.setFilter(Array.from(current));
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
                        this.settings.activeGroupId = group.id;
                        await this.plugin.saveSettings();
                        if (group.sort) this.viewState.setSort(group.sort.sortBy, group.sort.sortOrder);
                        if (group.filter) this.viewState.setFilter(group.filter.excludeExtensions);
                        else this.viewState.setFilter(this.settings.defaultFilter.excludeExtensions);
                        this.app.workspace.trigger('abstract-folder:group-changed');
                    }));
            });
            menu.addSeparator();
        }

        menu.addItem(item => item.setTitle("Manage groups").setIcon("gear").onClick(() => {
            new ManageGroupsModal(this.app, this.settings, (updatedGroups, activeGroupId) => {
                this.plugin.settings.groups = updatedGroups;
                this.plugin.settings.activeGroupId = activeGroupId;
                this.plugin.saveSettings().then(() => {
                    this.plugin.app.workspace.trigger('abstract-folder:group-changed');
                }).catch(Logger.error);
            }).open();
        }));

        menu.addItem(item => item.setTitle("Clear active group").setIcon(this.settings.activeGroupId === null ? "check" : "cross").onClick(async () => {
            this.settings.activeGroupId = null;
            await this.plugin.saveSettings();
            const defaultSort = this.plugin.settings.defaultSort;
            this.viewState.setSort(defaultSort.sortBy, defaultSort.sortOrder);
            this.viewState.setFilter(this.plugin.settings.defaultFilter.excludeExtensions);
            this.app.workspace.trigger('abstract-folder:group-changed');
        }));

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
