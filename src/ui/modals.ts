import { App, Modal, Setting, TFile, TFolder, Notice, FuzzySuggestModal, normalizePath } from "obsidian";
import { ConversionOptions, FileConflict } from "../conversion";
import { AbstractFolderPluginSettings } from "../settings";

export class ParentPickerModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Select parent note");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent) {
    this.onChoose(file);
  }
}

export type ChildFileType = 'note' | 'canvas' | 'base';

export class CreateAbstractChildModal extends Modal {
  private settings: AbstractFolderPluginSettings;
  private childName = "";
  private childType: ChildFileType; // Default handled by constructor or method
  private onSubmit: (childName: string, childType: ChildFileType) => void;

  constructor(app: App, settings: AbstractFolderPluginSettings, onSubmit: (childName: string, childType: ChildFileType) => void, initialChildType: ChildFileType = 'note') {
    super(app);
    this.settings = settings;
    this.onSubmit = onSubmit;
    this.childType = initialChildType; // Set initial type from parameter
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Create abstract child" });

    new Setting(contentEl)
      .setName("Child name")
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc("The name for the new file (e.g. 'Meeting notes', 'Project board').")
      .addText((text) => {
        text.inputEl.focus();
        text.onChange((value) => {
          this.childName = value;
        });
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
             this.submit();
          }
        });
      });

    new Setting(contentEl)
      .setName("Child type")
      .setDesc("Select the type of file to create.")
      .addDropdown((dropdown) => {
        dropdown.addOption('note', 'Markdown note');
        dropdown.addOption('canvas', 'Canvas');
        dropdown.addOption('base', 'Bases');
        dropdown.setValue(this.childType); // Set initial value from constructor
        dropdown.onChange((value: ChildFileType) => {
          this.childType = value;
        });
      });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Create")
          .setCta()
          .onClick(() => {
            this.submit();
          })
      );
  }

  private submit() {
    if (!this.childName) {
        new Notice("Child name is required.");
        return;
    }
    this.close();
    this.onSubmit(this.childName, this.childType);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}


export class RenameModal extends Modal {
    private file: TFile;
    private newName: string;

    constructor(app: App, file: TFile) {
        super(app);
        this.file = file;
        this.newName = file.basename;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Rename file" });

        new Setting(contentEl)
            .setName("New name")
            .addText((text) => {
                text.setValue(this.newName);
                text.inputEl.focus();
                text.inputEl.select(); // Select all text for easy replacement
                text.onChange((value) => {
                    this.newName = value;
                });
                text.inputEl.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                        this.submit();
                    }
                });
            });

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Rename")
                    .setCta()
                    .onClick(() => {
                        this.submit();
                    })
            );
    }

    private async submit() {
        if (!this.newName) {
            new Notice("Name cannot be empty.");
            return;
        }

        if (this.newName === this.file.basename) {
             this.close();
             return;
        }

        const parentPath = this.file.parent?.path || "";
        // Handle root directory where parent.path is '/'
        const directory = parentPath === "/" ? "" : parentPath;
        const newPath = (directory ? directory + "/" : "") + this.newName + "." + this.file.extension;

        try {
            await this.app.fileManager.renameFile(this.file, newPath);
            // new Notice(`Renamed to ${this.newName}`); // Obsidian usually shows a notice or updates UI automatically
            this.close();
        } catch (error) {
            new Notice(`Failed to rename: ${error}`);
            console.error(error);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class DeleteConfirmModal extends Modal {
    private file: TFile;
    private onConfirm: () => void;

    constructor(app: App, file: TFile, onConfirm: () => void) {
        super(app);
        this.file = file;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Delete file" });
        contentEl.createEl("p", { text: `Are you sure you want to delete "${this.file.name}"?` });

        const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
        
        const deleteButton = buttonContainer.createEl("button", { text: "Delete", cls: "mod-warning" });
        deleteButton.addEventListener("click", () => {
            this.onConfirm();
            this.close();
        });

        const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
        cancelButton.addEventListener("click", () => {
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class BatchDeleteConfirmModal extends Modal {
    private files: TFile[];
    private onConfirm: () => void;

    constructor(app: App, files: TFile[], onConfirm: () => void) {
        super(app);
        this.files = files;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: `Delete ${this.files.length} files` });
        contentEl.createEl("p", { text: `Are you sure you want to delete these ${this.files.length} files?` });
        
        const list = contentEl.createEl("ul");
        // Show up to 5 files, then "...and X more"
        const maxDisplay = 5;
        this.files.slice(0, maxDisplay).forEach(file => {
            list.createEl("li", { text: file.name });
        });
        if (this.files.length > maxDisplay) {
            list.createEl("li", { text: `...and ${this.files.length - maxDisplay} more` });
        }

        const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
        
        const deleteButton = buttonContainer.createEl("button", { text: "Delete all", cls: "mod-warning" });
        deleteButton.addEventListener("click", () => {
            this.onConfirm();
            this.close();
        });

        const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
        cancelButton.addEventListener("click", () => {
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class FolderSelectionModal extends FuzzySuggestModal<TFolder> {
    private onChoose: (folder: TFolder) => void;

    constructor(app: App, onChoose: (folder: TFolder) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder("Select a folder to convert...");
    }

    getItems(): TFolder[] {
        const allFiles = this.app.vault.getAllLoadedFiles();
        return allFiles.filter((f): f is TFolder => f instanceof TFolder);
    }

    getItemText(folder: TFolder): string {
        return folder.path;
    }

    onChooseItem(folder: TFolder, evt: MouseEvent | KeyboardEvent) {
        this.onChoose(folder);
    }
}

export class ConversionOptionsModal extends Modal {
    private folder: TFolder;
    private onConfirm: (options: ConversionOptions) => void;
    private options: ConversionOptions = {
        createParentNotes: true,
        existingRelationshipsStrategy: 'append',
        folderNoteStrategy: 'outside'
    };

    constructor(app: App, folder: TFolder, onConfirm: (options: ConversionOptions) => void) {
        super(app);
        this.folder = folder;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Convert folder structure" });
        contentEl.createEl("p", { text: `Convert folder "${this.folder.path}" to Abstract Folder format.` });

        new Setting(contentEl)
            .setName("Create parent notes")
            .setDesc("Create a corresponding Markdown note for folders if one doesn't exist.")
            .addToggle(toggle => toggle
                .setValue(this.options.createParentNotes)
                .onChange(value => this.options.createParentNotes = value));

        new Setting(contentEl)
            .setName("Existing relationships")
            .setDesc("How to handle files that already have parents defined.")
            .addDropdown(dropdown => dropdown
                .addOption('append', 'Append new parents')
                .addOption('replace', 'Replace existing parents')
                .setValue(this.options.existingRelationshipsStrategy)
                .onChange((value: 'append' | 'replace') => this.options.existingRelationshipsStrategy = value));

        new Setting(contentEl)
            .setName("Folder note strategy")
            .setDesc("Where to look for the note representing the folder.")
            .addDropdown(dropdown => dropdown
                .addOption('outside', 'Outside (Sibling note, e.g. "Folder.md" next to "Folder/")')
                .addOption('inside', 'Inside (Index note, e.g. "Folder/Folder.md")')
                .setValue(this.options.folderNoteStrategy)
                .onChange((value: 'outside' | 'inside') => this.options.folderNoteStrategy = value));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText("Convert")
                .setCta()
                .onClick(() => {
                    this.onConfirm(this.options);
                    this.close();
                }));
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class ScopeSelectionModal extends Modal {
    private onConfirm: (scope: 'vault' | TFile) => void;

    constructor(app: App, onConfirm: (scope: 'vault' | TFile) => void) {
        super(app);
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Select export scope" });

        new Setting(contentEl)
            .setName("Entire vault")
            .setDesc("Export the entire abstract structure to folders.")
            .addButton(btn => btn
                .setButtonText("Export all")
                .onClick(() => {
                    this.onConfirm('vault');
                    this.close();
                }));

        new Setting(contentEl)
            .setName("Specific branch")
            .setDesc("Export starting from a specific parent note.")
            .addButton(btn => btn
                .setButtonText("Select note")
                .setCta()
                .onClick(() => {
                    this.close();
                    new ParentPickerModal(this.app, (file) => {
                        this.onConfirm(file);
                    }).open();
                }));
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class DestinationPickerModal extends FuzzySuggestModal<TFolder> {
    private onChoose: (folder: TFolder) => void;

    constructor(app: App, onChoose: (folder: TFolder) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder("Select destination parent folder...");
    }

    getItems(): TFolder[] {
        const allFiles = this.app.vault.getAllLoadedFiles();
        return allFiles.filter((f): f is TFolder => f instanceof TFolder);
    }

    getItemText(folder: TFolder): string {
        return folder.path;
    }

    onChooseItem(folder: TFolder, evt: MouseEvent | KeyboardEvent) {
        this.onChoose(folder);
    }
}

export class NewFolderNameModal extends Modal {
    private parentFolder: TFolder;
    private onConfirm: (fullPath: string, placeIndexFileInside: boolean) => void;
    private folderName = "Abstract Export";
    private placeIndexFileInside = true;

    constructor(app: App, parentFolder: TFolder, onConfirm: (fullPath: string, placeIndexFileInside: boolean) => void) {
        super(app);
        this.parentFolder = parentFolder;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Name export folder" });
        contentEl.createEl("p", { text: `Creating new folder inside: ${this.parentFolder.path === '/' ? 'Root' : this.parentFolder.path}` });

        new Setting(contentEl)
            .setName("Folder name")
            .setDesc("Enter a name for the folder that will contain the exported structure.")
            .addText(text => text
                .setValue(this.folderName)
                .onChange(value => this.folderName = value));

        new Setting(contentEl)
            .setName("Create index files")
            .setDesc("ON: Create 'Folder/Folder.md' containing the note content. OFF: Create only the folder 'Folder/' (excludes note content if it has children).")
            .addToggle(toggle => toggle
                .setValue(this.placeIndexFileInside)
                .onChange(value => this.placeIndexFileInside = value));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText("Confirm")
                .setCta()
                .onClick(() => {
                    if (!this.folderName) {
                        new Notice("Please enter a folder name.");
                        return;
                    }
                    // Construct full path and normalize it
                    const parentPath = this.parentFolder.path === '/' ? '' : this.parentFolder.path + '/';
                    const fullPath = normalizePath(parentPath + this.folderName);
                    this.onConfirm(fullPath, this.placeIndexFileInside);
                    this.close();
                }));
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class SimulationModal extends Modal {
    private conflicts: FileConflict[];
    private onConfirm: (conflicts: FileConflict[]) => void;

    constructor(app: App, conflicts: FileConflict[], onConfirm: (conflicts: FileConflict[]) => void) {
        super(app);
        this.conflicts = conflicts;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Review folder generation" });

        if (this.conflicts.length === 0) {
            contentEl.createEl("p", { text: "No conflicts detected. Ready to generate." });
        } else {
            contentEl.createEl("p", { text: `${this.conflicts.length} files have multiple parents. Please resolve conflicts.` });
            
            const conflictContainer = contentEl.createDiv({ cls: "abstract-folder-conflict-container" });

            this.conflicts.forEach(conflict => {
                const div = conflictContainer.createDiv({ cls: "abstract-folder-conflict-item" });

                div.createEl("strong", { text: conflict.file.path });
                
                new Setting(div)
                    .setName("Resolution")
                    .addDropdown(dropdown => {
                        dropdown.addOption('duplicate', 'Duplicate in all locations');
                        conflict.targetPaths.forEach(path => {
                            dropdown.addOption(path, `Move to: ${path}`);
                        });
                        dropdown.setValue('duplicate');
                        dropdown.onChange(value => {
                            conflict.resolution = value;
                        });
                    });
            });
        }

        const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
        buttonContainer.createEl("button", { text: "Generate folders", cls: "mod-cta" })
            .addEventListener("click", () => {
                this.onConfirm(this.conflicts);
                this.close();
            });
    }

    onClose() {
        this.contentEl.empty();
    }
}