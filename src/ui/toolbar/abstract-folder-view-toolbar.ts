import { App, Menu, setIcon, TFolder, Notice } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import type AbstractFolderPlugin from "main";
import { CreateAbstractChildModal, PersonalBackupModal } from "../modals";
import { createAbstractChildFile } from "../../utils/file-operations";
import { ManageSortingModal } from "../modals/manage-sorting-modal";
import { AbstractFolderToolbar } from "./abstract-folder-toolbar";
import { GlobalContentProvider } from "../../core/content-provider";

export class AbstractFolderViewToolbar {
    private abstractFolderToolbar: AbstractFolderToolbar;

    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private plugin: AbstractFolderPlugin,
        private contextEngine: any, 
        private containerEl: HTMLElement,
        private focusSearch: () => void,
        private focusActiveFile: () => void,
    ) {
        // Create a provider for the toolbar to check capabilities
        const provider = new GlobalContentProvider(app, settings, null);

        this.abstractFolderToolbar = new AbstractFolderToolbar(
            app,
            settings,
            plugin,
            contextEngine,
            {
                containerEl: containerEl,
                provider: provider,
                showFocusButton: settings.showFocusActiveFileButton,
                showConversionButton: settings.showConversionButton,
                showCollapseButton: settings.showCollapseAllButton,
                showExpandButton: true, 
                showSortButton: settings.showSortButton,
                showFilterButton: settings.showFilterButton,
                showGroupButton: settings.showGroupButton,
                showCreateNoteButton: settings.showCreateNoteButton,
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


}
