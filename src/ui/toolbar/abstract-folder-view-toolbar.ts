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

        const visibility = settings.visibility.default;

        this.abstractFolderToolbar = new AbstractFolderToolbar(
            app,
            settings,
            plugin,
            contextEngine,
            {
                containerEl: containerEl,
                provider: provider,
                showFocusButton: visibility.showFocusActiveFileButton,
                showConversionButton: visibility.showConversionButton,
                showCollapseButton: visibility.showCollapseAllButton,
                showExpandButton: visibility.showExpandAllButton,
                showSortButton: visibility.showSortButton,
                showFilterButton: visibility.showFilterButton,
                showGroupButton: visibility.showGroupButton,
                showCreateNoteButton: visibility.showCreateNoteButton,
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
