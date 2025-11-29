import { App, Modal, Setting, TFile, Notice, FuzzySuggestModal } from "obsidian";
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
    contentEl.createEl("h2", { text: "Create Abstract Child" });

    new Setting(contentEl)
      .setName("Child Name")
      .setDesc("The name for the new file (e.g., 'Meeting Notes', 'Project Board').")
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
      .setName("Child Type")
      .setDesc("Select the type of file to create.")
      .addDropdown((dropdown) => {
        dropdown.addOption('note', 'Markdown Note');
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
        contentEl.createEl("h2", { text: "Rename File" });

        new Setting(contentEl)
            .setName("New Name")
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
        contentEl.createEl("h2", { text: "Delete File" });
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
        contentEl.createEl("h2", { text: `Delete ${this.files.length} Files` });
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
        
        const deleteButton = buttonContainer.createEl("button", { text: "Delete All", cls: "mod-warning" });
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