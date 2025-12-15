import { App, Modal, Setting, TFolder, TFile, Notice, AbstractInputSuggest } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import { FolderIndexer } from "../../indexer";
import { FolderSelectionModal, ParentPickerModal } from "../modals";
import { AbstractFolderFrontmatter } from "../../types";
import { FileInputSuggest } from "../settings-tab";
import { createAbstractChildFile } from "../../utils/file-operations";

class FolderInputSuggest extends AbstractInputSuggest<string> {
    constructor(app: App, private inputEl: HTMLInputElement) {
        super(app, inputEl);
    }

    getSuggestions(inputStr: string): string[] {
        const folders: string[] = [];
        
        
        const collectFolders = (folder: TFolder) => {
            if (folder.path !== "/") {
                 folders.push(folder.path);
            }
            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    collectFolders(child);
                }
            }
        };
        collectFolders(this.app.vault.getRoot());

        const lowerCaseInputStr = inputStr.toLowerCase();
        return folders.filter(path =>
            path.toLowerCase().includes(lowerCaseInputStr)
        );
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.setText(value);
    }

    selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
        this.inputEl.value = value;
        this.inputEl.trigger("input");
        this.close();
    }
}

export class CreateSyncedFolderModal extends Modal {
    private settings: AbstractFolderPluginSettings;
    private indexer: FolderIndexer;
    private onComplete: () => void;
    private abstractFilePath: string = "";
    private physicalFolderPath: string = "";
    private mode: "existing" | "create" = "existing";
    private newFileName: string = "";
    private newFileParentPath: string = "";
    private importExisting: boolean = false;

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

        // Mode Selection
        new Setting(contentEl)
            .setName("Abstract file source")
            .setDesc("Choose whether to use an existing abstract file or create a new one.")
            .addDropdown(dropdown => dropdown
                .addOption("existing", "Use existing file")
                .addOption("create", "Create new file")
                .setValue(this.mode)
                .onChange((value: "existing" | "create") => {
                    this.mode = value;
                    this.onOpen();
                })
            );

        if (this.mode === "existing") {
            // Abstract File Selection
            new Setting(contentEl)
                .setName("Select abstract file")
                .setDesc("The abstract file that will act as the parent.")
                .addText(text => {
                    text.setPlaceholder("Path to note")
                        .setValue(this.abstractFilePath)
                        .onChange(value => this.abstractFilePath = value);
                    new FileInputSuggest(this.app, text.inputEl);
                })
                .addButton(button => button
                    .setIcon("file")
                    .setTooltip("Choose file from picker")
                    .onClick(() => {
                        new ParentPickerModal(this.app, (file) => {
                            if (file instanceof TFile) {
                                this.abstractFilePath = file.path;
                                this.onOpen(); // Re-render to update value
                            } else {
                                new Notice("Please select a valid abstract file (Markdown note).");
                            }
                        }).open();
                    }));
        } else {
            // New File Creation
            new Setting(contentEl)
                .setName("New file name")
                .setDesc("Name of the new abstract file.")
                .addText(text => text
                    .setPlaceholder("My synced folder")
                    .setValue(this.newFileName)
                    .onChange(value => this.newFileName = value));
            
            new Setting(contentEl)
                .setName("Abstract parent (optional)")
                .setDesc("Where to place this new file in the abstract tree.")
                .addText(text => {
                    text.setPlaceholder("Path to parent note")
                        .setValue(this.newFileParentPath)
                        .onChange(value => this.newFileParentPath = value);
                    new FileInputSuggest(this.app, text.inputEl);
                })
                .addButton(button => button
                    .setIcon("file")
                    .setTooltip("Choose parent file")
                    .onClick(() => {
                        new ParentPickerModal(this.app, (file) => {
                            if (file instanceof TFile) {
                                this.newFileParentPath = file.path;
                                this.onOpen();
                            }
                        }).open();
                    }));
        }

        // Physical Folder Selection
        new Setting(contentEl)
            .setName("Select physical folder")
            .setDesc("The physical folder to sync with.")
            .addText(text => {
                text.setPlaceholder("Path to folder")
                    .setValue(this.physicalFolderPath)
                    .onChange(value => this.physicalFolderPath = value);
                new FolderInputSuggest(this.app, text.inputEl);
            })
            .addButton(button => button
                .setIcon("folder")
                .setTooltip("Choose folder from picker")
                .onClick(() => {
                    new FolderSelectionModal(this.app, (folder) => {
                        this.physicalFolderPath = folder.path;
                        this.onOpen(); // Re-render to update value
                    }).open();
                }));

        new Setting(contentEl)
            .setName("Import existing files")
            .setDesc("Automatically link files currently inside the physical folder to this abstract folder.")
            .addToggle(toggle => toggle
                .setValue(this.importExisting)
                .onChange(value => this.importExisting = value));

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText("Create sync")
                .setCta()
                .onClick(async () => {
                    await this.createSync();
                }))
            .addButton(button => button
                .setButtonText("Cancel")
                .onClick(() => {
                    this.close();
                    this.onComplete();
                }));
    }

    async createSync() {
        if (!this.physicalFolderPath) {
             new Notice("Please specify a physical folder.");
             return;
        }

        let targetAbstractFile: TFile | null = null;

        if (this.mode === "existing") {
             if (!this.abstractFilePath) {
                new Notice("Please specify an abstract file.");
                return;
            }
            const file = this.app.vault.getAbstractFileByPath(this.abstractFilePath);
            if (!(file instanceof TFile)) {
                 new Notice("Abstract file not found or is not a file.");
                 return;
            }
            targetAbstractFile = file;
        } else {
            // Create new file
             if (!this.newFileName) {
                new Notice("Please specify a name for the new file.");
                return;
            }
            
            // Check existence
            const safeName = this.newFileName.replace(/[\\/:*?"<>|]/g, "");
            
            let parentFile: TFile | null = null;
            if (this.newFileParentPath) {
                const p = this.app.vault.getAbstractFileByPath(this.newFileParentPath);
                if (p instanceof TFile) parentFile = p;
            }
            
            const newFile = await createAbstractChildFile(this.app, this.settings, safeName, parentFile, 'note');
            
            if (newFile) {
                targetAbstractFile = newFile;
            } else {
                return; // Error handled in createAbstractChildFile
            }
        }

        if (targetAbstractFile) {
            const mdFilesToUpdate: TFile[] = [];
            const nonMdFilesToLink: TFile[] = [];

            if (this.importExisting) {
                const physicalFolder = this.app.vault.getAbstractFileByPath(this.physicalFolderPath);
                if (physicalFolder instanceof TFolder) {
                    for (const child of physicalFolder.children) {
                        if (child instanceof TFile) {
                            if (child.extension === 'md') {
                                // Prevent linking to itself if the abstract file is inside the folder
                                if (child.path !== targetAbstractFile.path) {
                                    mdFilesToUpdate.push(child);
                                }
                            } else {
                                nonMdFilesToLink.push(child);
                            }
                        }
                    }
                }
            }

            await this.app.fileManager.processFrontMatter(targetAbstractFile, (frontmatter: AbstractFolderFrontmatter) => {
                frontmatter[this.settings.syncPropertyName] = this.physicalFolderPath;

                if (nonMdFilesToLink.length > 0) {
                    const childrenProp = this.settings.childrenPropertyName;
                    const rawChildren = frontmatter[childrenProp];
                    let childrenList: string[] = [];
                    if (typeof rawChildren === 'string') {
                        childrenList = [rawChildren];
                    } else if (Array.isArray(rawChildren)) {
                        childrenList = rawChildren as string[];
                    }

                    for (const file of nonMdFilesToLink) {
                        const newLink = `[[${file.name}]]`;
                        if (!childrenList.includes(newLink)) {
                            childrenList.push(newLink);
                        }
                    }
                    frontmatter[childrenProp] = childrenList.length === 1 ? childrenList[0] : childrenList;
                }
            });

            if (mdFilesToUpdate.length > 0) {
                for (const file of mdFilesToUpdate) {
                    await this.app.fileManager.processFrontMatter(file, (frontmatter: AbstractFolderFrontmatter) => {
                        const parentPropertyName = this.settings.propertyName;
                        const rawParents = frontmatter[parentPropertyName];
                        let parentLinks: string[] = [];
                        if (typeof rawParents === 'string') {
                            parentLinks = [rawParents];
                        } else if (Array.isArray(rawParents)) {
                            parentLinks = rawParents as string[];
                        }

                        const newLink = `[[${targetAbstractFile.basename}]]`;
                        if (!parentLinks.includes(newLink)) {
                            parentLinks.push(newLink);
                        }

                        frontmatter[parentPropertyName] = parentLinks.length === 1 ? parentLinks[0] : parentLinks;
                    });
                }
                new Notice(`Imported ${mdFilesToUpdate.length} notes and linked ${nonMdFilesToLink.length} files.`);
            }

            new Notice(`Synced ${targetAbstractFile.basename} to ${this.physicalFolderPath}`);
            this.indexer.rebuildGraphAndTriggerUpdate();
            
            this.close();
            this.onComplete();
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}