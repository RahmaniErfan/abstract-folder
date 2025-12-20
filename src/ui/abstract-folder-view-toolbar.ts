import { App, setIcon, Menu } from "obsidian";
import { AbstractFolderPluginSettings } from "../settings";
import AbstractFolderPlugin from "../../main";
import { CreateAbstractChildModal, ChildFileType } from './modals';
import { ManageGroupsModal } from './modals/manage-groups-modal';
import { ManageSortingModal } from './modals/manage-sorting-modal';
import { ViewState } from './view-state';
import { createAbstractChildFile } from '../utils/file-operations';
import { Group } from "../types";

export class AbstractFolderViewToolbar {
    private app: App;
    private settings: AbstractFolderPluginSettings;
    private plugin: AbstractFolderPlugin;
    private viewState: ViewState;

    private viewStyleToggleAction: HTMLElement | undefined;
    private expandAllAction: HTMLElement | undefined;
    private collapseAllAction: HTMLElement | undefined;

    // Callbacks provided by AbstractFolderView to interact with it
    private addAction: (icon: string, title: string, onclick: (evt: MouseEvent) => void) => HTMLElement;
    private renderView: () => void;
    private expandAllView: () => void; // New callback
    private collapseAllView: () => void; // New callback


    constructor(
        app: App,
        settings: AbstractFolderPluginSettings,
        plugin: AbstractFolderPlugin,
        viewState: ViewState,
        addActionCallback: (icon: string, title: string, onclick: (evt: MouseEvent) => void) => HTMLElement,
        renderViewCallback: () => void,
        expandAllViewCallback: () => void,
        collapseAllViewCallback: () => void,
    ) {
        this.app = app;
        this.settings = settings;
        this.plugin = plugin;
        this.viewState = viewState;
        this.addAction = addActionCallback;
        this.renderView = renderViewCallback;
        this.expandAllView = expandAllViewCallback;
        this.collapseAllView = collapseAllViewCallback;
    }

    public setupToolbarActions(): void {
        this.addAction("file-plus", "Create new root note", () => {
            new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
                createAbstractChildFile(this.app, this.settings, childName, null, childType).catch(console.error);
            }, 'note').open();
        });

        this.addAction("group", "Select group", (evt: MouseEvent) => this.showGroupMenu(evt));

        this.addAction("arrow-up-down", "Sort order", (evt: MouseEvent) => this.showSortMenu(evt));
        this.expandAllAction = this.addAction("chevrons-up-down", "Expand all folders", () => this.expandAllView());
        this.collapseAllAction = this.addAction("chevrons-down-up", "Collapse all folders", () => this.collapseAllView());
        
        this.addAction("lucide-folder-sync", "Convert folder structure", (evt: MouseEvent) => this.showConversionMenu(evt));

        this.viewStyleToggleAction = this.addAction("list", "Switch view style", () => this.viewState.toggleViewStyle());
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

        menu.addItem((item) =>
            item
                .setTitle("Manage default sorting")
                .setIcon("gear")
                .onClick(() => {
                     new ManageSortingModal(this.app, this.settings, (updatedSettings) => {
                        this.plugin.settings = updatedSettings;
                        this.plugin.saveSettings().then(() => {
                             // Determine which sort config to apply based on active group
                            let sortConfig = this.plugin.settings.defaultSort;
                            if (this.plugin.settings.activeGroupId) {
                                const activeGroup = this.plugin.settings.groups.find(g => g.id === this.plugin.settings.activeGroupId);
                                if (activeGroup && activeGroup.sort) {
                                    sortConfig = activeGroup.sort;
                                }
                            }
                            // Apply the sort config
                            this.viewState.setSort(sortConfig.sortBy, sortConfig.sortOrder);
                        }).catch(console.error);
                     }).open();
                })
        );
        menu.addSeparator();

        menu.addItem((item) =>
            item
                .setTitle("Sort by name (ascending)")
                .setIcon(this.viewState.sortBy === 'name' && this.viewState.sortOrder === 'asc' ? "check" : "sort-asc")
                .onClick(() => this.viewState.setSort('name', 'asc'))
        );
        menu.addItem((item) =>
            item
                .setTitle("Sort by name (descending)")
                .setIcon(this.viewState.sortBy === 'name' && this.viewState.sortOrder === 'desc' ? "check" : "sort-desc")
                .onClick(() => this.viewState.setSort('name', 'desc'))
        );
        menu.addSeparator();
        menu.addItem((item) =>
            item
                .setTitle("Sort by modified (old to new)")
                .setIcon(this.viewState.sortBy === 'mtime' && this.viewState.sortOrder === 'asc' ? "check" : "sort-asc")
                .onClick(() => this.viewState.setSort('mtime', 'asc'))
        );
        menu.addItem((item) =>
            item
                .setTitle("Sort by modified (new to old)")
                .setIcon(this.viewState.sortBy === 'mtime' && this.viewState.sortOrder === 'desc' ? "check" : "sort-desc")
                .onClick(() => this.viewState.setSort('mtime', 'desc'))
        );
        menu.addSeparator();
        menu.addItem((item) =>
            item
                .setTitle("Sort by thermal (most to least)")
                .setIcon(this.viewState.sortBy === 'thermal' && this.viewState.sortOrder === 'desc' ? "check" : "flame")
                .onClick(() => this.viewState.setSort('thermal', 'desc'))
        );
        menu.addItem((item) =>
            item
                .setTitle("Sort by thermal (least to most)")
                .setIcon(this.viewState.sortBy === 'thermal' && this.viewState.sortOrder === 'asc' ? "check" : "flame")
                .onClick(() => this.viewState.setSort('thermal', 'asc'))
        );
        menu.addSeparator();
        menu.addItem((item) =>
            item
                .setTitle("Sort by stale rot (most to least)")
                .setIcon(this.viewState.sortBy === 'rot' && this.viewState.sortOrder === 'desc' ? "check" : "skull")
                .onClick(() => this.viewState.setSort('rot', 'desc'))
        );
        menu.addItem((item) =>
            item
                .setTitle("Sort by stale rot (least to most)")
                .setIcon(this.viewState.sortBy === 'rot' && this.viewState.sortOrder === 'asc' ? "check" : "skull")
                .onClick(() => this.viewState.setSort('rot', 'asc'))
        );
        menu.addSeparator();
        menu.addItem((item) =>
            item
                .setTitle("Sort by gravity (heaviest to lightest)")
                .setIcon(this.viewState.sortBy === 'gravity' && this.viewState.sortOrder === 'desc' ? "check" : "weight")
                .onClick(() => this.viewState.setSort('gravity', 'desc'))
        );
        menu.addItem((item) =>
            item
                .setTitle("Sort by gravity (lightest to heaviest)")
                .setIcon(this.viewState.sortBy === 'gravity' && this.viewState.sortOrder === 'asc' ? "check" : "weight")
                .onClick(() => this.viewState.setSort('gravity', 'asc'))
        );
        menu.showAtMouseEvent(event);
    }

    private showGroupMenu(event: MouseEvent): void {
        const menu = new Menu();

        if (this.settings.groups.length === 0) {
            menu.addItem(item => item.setTitle("No groups defined").setDisabled(true));
        } else {
            this.settings.groups.forEach((group: Group) => { // Explicitly typed group
                menu.addItem(item =>
                    item.setTitle(group.name)
                        .setIcon(this.settings.activeGroupId === group.id ? "check" : "group")
                        .onClick(async () => {
                            this.settings.activeGroupId = group.id;
                            await this.plugin.saveSettings();

                            // Apply group default sort if available
                            if (group.sort) {
                                this.viewState.setSort(group.sort.sortBy, group.sort.sortOrder);
                            }

                            this.renderView(); // Trigger re-render of the view
                        })
                );
            });
            menu.addSeparator();
        }

        menu.addItem(item =>
            item.setTitle("Manage groups")
                .setIcon("gear")
                .onClick(() => {
                    new ManageGroupsModal(this.app, this.settings, (updatedGroups: Group[], activeGroupId: string | null) => {
                        this.plugin.settings.groups = updatedGroups;
                        this.plugin.settings.activeGroupId = activeGroupId;
                        this.plugin.saveSettings().then(() => {
                            this.plugin.app.workspace.trigger('abstract-folder:group-changed');
                        }).catch(console.error);
                    }).open();
                })
        );

        menu.addItem(item =>
            item.setTitle("Clear active group")
                .setIcon(this.settings.activeGroupId === null ? "check" : "cross")
                .onClick(async () => {
                    this.settings.activeGroupId = null;
                    await this.plugin.saveSettings();
                    
                    // Revert to default sort
                    const defaultSort = this.plugin.settings.defaultSort;
                    this.viewState.setSort(defaultSort.sortBy, defaultSort.sortOrder);

                    this.renderView(); // Trigger re-render of the view
                })
        );

        menu.showAtMouseEvent(event);
    }

    private showConversionMenu(event: MouseEvent): void {
        const menu = new Menu();

        menu.addItem((item) =>
            item
                .setTitle("Convert physical folder to abstract folder")
                .setIcon("folder-symlink")
                .onClick(() => {
                    this.plugin.app.commands.executeCommandById("abstract-folder:convert-folder-to-plugin");
                })
        );

        menu.addItem((item) =>
            item
                .setTitle("Create folder structure from plugin format")
                .setIcon("folder-plus")
                .onClick(() => {
                    this.plugin.app.commands.executeCommandById("abstract-folder:create-folders-from-plugin");
                })
        );

        menu.showAtMouseEvent(event);
    }
}
