import { App, Modal, Setting, TFile, Notice, FuzzySuggestModal } from "obsidian";
import { AbstractFolderPluginSettings } from "./settings";

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

export class CreateChildModal extends Modal {
  private settings: AbstractFolderPluginSettings;
  private childName = "";
  private onSubmit: (childName: string) => void;

  constructor(app: App, settings: AbstractFolderPluginSettings, onSubmit: (childName: string) => void) {
    super(app);
    this.settings = settings;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Create Abstract Child Note" });

    new Setting(contentEl)
      .setName("Child Name")
      .setDesc("The virtual name for the new note (e.g., 'Logs').")
      .addText((text) => {
        text.inputEl.focus(); // Auto-focus the input
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
      .addButton((btn) =>
        btn
          .setButtonText("Next: Select Parent")
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
    this.onSubmit(this.childName);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export async function createChildNote(app: App, settings: AbstractFolderPluginSettings, childName: string, parentFile: TFile) {
    const parentBaseName = parentFile.basename;
    
    // Contextual Suffix Naming Strategy
    // 1. Try just the child name: "Logs.md"
    // 2. If exists, try "Logs (Parent).md"
    // 3. If exists, try "Logs (Parent) 1.md"
    
    const safeChildName = childName.replace(/[\\/:*?"<>|]/g, "");
    const safeParentName = parentBaseName.replace(/[\\/:*?"<>|]/g, "");
    
    let fileName = `${safeChildName}.md`;
    
    if (app.vault.getAbstractFileByPath(fileName)) {
        // Collision #1: Try adding parent context suffix
        fileName = `${safeChildName} (${safeParentName}).md`;
        
        if (app.vault.getAbstractFileByPath(fileName)) {
            // Collision #2: Add numeric counter
            let counter = 1;
            while (app.vault.getAbstractFileByPath(fileName)) {
                 fileName = `${safeChildName} (${safeParentName}) ${counter}.md`;
                 counter++;
            }
        }
    }

    // We strictly use the parent's base name for the link to ensure it matches what the indexer expects
    // The indexer expects "[[ParentName]]" (quoted) to be safe in YAML
    // We must ensure parentBaseName does not contain quotes which might break YAML
    const cleanParentName = parentBaseName.replace(/"/g, '');
    
    const frontmatterContent = `---
${settings.propertyName}: "[[${cleanParentName}]]"
aliases:
  - ${childName}
---

# ${childName}
`;

    try {
        const file = await app.vault.create(fileName, frontmatterContent);
        new Notice(`Created: ${fileName}`);
        app.workspace.getLeaf(true).openFile(file);
    } catch (error) {
        new Notice(`Failed to create file: ${error}`);
        console.error(error);
    }
}