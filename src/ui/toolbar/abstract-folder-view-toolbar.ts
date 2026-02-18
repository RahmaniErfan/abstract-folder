import { App, Menu, setIcon, TFolder, Notice } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import type AbstractFolderPlugin from "main";
import { CreateAbstractChildModal, PersonalBackupModal } from "../modals";
import { createAbstractChildFile } from "../../utils/file-operations";
import { ManageSortingModal } from "../modals/manage-sorting-modal";
import { AbstractFolderToolbar } from "./abstract-folder-toolbar";

export class AbstractFolderViewToolbar {
    private abstractFolderToolbar: AbstractFolderToolbar;

    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private plugin: AbstractFolderPlugin,
        private containerEl: HTMLElement,
        private focusSearch: () => void,
        private focusActiveFile: () => void,
    ) {
        this.abstractFolderToolbar = new AbstractFolderToolbar(
            app,
            settings,
            plugin,
            plugin.contextEngine,
            {
                containerEl: containerEl,
                showFocusButton: settings.showFocusActiveFileButton,
                showConversionButton: settings.showConversionButton,
                showCollapseButton: settings.showCollapseAllButton,
                showExpandButton: true, // Always show if we want to support it, or check settings if we add it
                showViewStyleButton: true, // Always show for personal view
                showSortButton: settings.showSortButton,
                showFilterButton: settings.showFilterButton,
                showGroupButton: settings.showGroupButton,
                showCreateNoteButton: settings.showCreateNoteButton,
                // Personal view doesn't typically have "create folder" button in toolbar, usually via modal or context menu
                // But if we want it, we can enable it. The original didn't seem to have it in the main toolbar.
                showCreateFolderButton: false, 
                focusActiveFile: focusActiveFile
            }
        );
    }

    public setupToolbarActions(): void {
        this.abstractFolderToolbar.render();
    }

    public updateButtonStates(): void {
        this.abstractFolderToolbar.updateButtonStates();
    }

    public updateViewStyleToggleButton(): void {
        this.abstractFolderToolbar.updateViewStyleToggleButton();
    }
}
