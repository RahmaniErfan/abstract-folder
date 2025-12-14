import { App, Modal, Setting, TFolder, TFile, Notice } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import { FolderIndexer } from "../../indexer";
import { FolderSelectionModal, ParentPickerModal } from "../modals";
import { AbstractFolderFrontmatter } from "../../types";

export class CreateSyncedFolderModal extends Modal {
    private settings: AbstractFolderPluginSettings;
    private indexer: FolderIndexer;
    private onComplete: () => void;
    private selectedAbstractFile: TFile | null = null;
    private selectedPhysicalFolder: TFolder | null = null;

    constructor(app: App, settings: AbstractFolderPluginSettings, indexer: FolderIndexer, onComplete: () => void) {
        super(app);
        this.settings = settings;
        this.indexer = indexer;
        this.onComplete = onComplete;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Create new sync" });

        new Setting(contentEl)
            .setName("Select abstract file")
            .setDesc("The abstract file that will act as the parent.")
            .addText(text => text
                .setPlaceholder("No file selected")
                .setValue(this.selectedAbstractFile ? this.selectedAbstractFile.path : "")
                .setDisabled(true)
            )
            .addButton(button => button
                .setButtonText("Choose file")
                .onClick(() => {
                    new ParentPickerModal(this.app, (file) => {
                        if (file instanceof TFile) {
                            this.selectedAbstractFile = file;
                            this.onOpen(); // Re-render
                        } else {
                            new Notice("Please select a valid abstract file (Markdown note).");
                        }
                    }).open();
                }));

        new Setting(contentEl)
            .setName("Select physical folder")
            .setDesc("The physical folder to sync with.")
            .addText(text => text
                .setPlaceholder("No folder selected")
                .setValue(this.selectedPhysicalFolder ? this.selectedPhysicalFolder.path : "")
                .setDisabled(true)
            )
            .addButton(button => button
                .setButtonText("Choose folder")
                .onClick(() => {
                    new FolderSelectionModal(this.app, (folder) => {
                        this.selectedPhysicalFolder = folder;
                        this.onOpen(); // Re-render
                    }).open();
                }));

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText("Create sync")
                .setCta()
                .onClick(async () => {
                    if (this.selectedAbstractFile && this.selectedPhysicalFolder) {
                        await this.createSync();
                        this.close();
                        this.onComplete();
                    } else {
                        new Notice("Please select both an abstract file and a physical folder.");
                    }
                }))
            .addButton(button => button
                .setButtonText("Cancel")
                .onClick(() => {
                    this.close();
                    this.onComplete();
                }));
    }

    async createSync() {
        if (!this.selectedAbstractFile || !this.selectedPhysicalFolder) return;

        await this.app.fileManager.processFrontMatter(this.selectedAbstractFile, (frontmatter: AbstractFolderFrontmatter) => {
            frontmatter[this.settings.syncPropertyName] = this.selectedPhysicalFolder!.path;
        });

        new Notice(`Synced ${this.selectedAbstractFile.basename} to ${this.selectedPhysicalFolder.path}`);
        this.indexer.rebuildGraphAndTriggerUpdate();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}