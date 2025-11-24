import { App, Modal, Setting, TFile, Notice } from "obsidian";
import { AbstractFolderPluginSettings } from "./settings";

export class CreateChildModal extends Modal {
  private settings: AbstractFolderPluginSettings;
  private childName = "";
  private parentPath = "";
  private parentFile: TFile | null = null;
  private onSubmit: (childName: string, parentFile: TFile) => void;

  constructor(app: App, settings: AbstractFolderPluginSettings, onSubmit: (childName: string, parentFile: TFile) => void) {
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
      .addText((text) =>
        text.onChange((value) => {
          this.childName = value;
        })
      );

    new Setting(contentEl)
      .setName("Parent Note")
      .setDesc("Select the parent note.")
      .addText((text) => {
          text.setPlaceholder("Search parent note (fuzzy match)")
          text.onChange((value) => {
              if (!value) {
                this.parentFile = null;
                return;
              }
              // Simple iterative search for first match that contains the value (case-insensitive)
              // This fixes the strict "Exact name" requirement
              const files = this.app.vault.getMarkdownFiles();
              const match = files.find(f => f.basename.toLowerCase().includes(value.toLowerCase()));
              
              if (match) {
                  this.parentFile = match;
                  this.parentPath = match.path;
                  // We don't want to spam notifications on every keystroke
                  // But visual feedback in a real SuggestModal would be better.
                  // For now, let's assume if they type enough, they find it.
                  // console.log(`Found candidate: ${match.path}`);
              } else {
                  this.parentFile = null;
              }
          });
      });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Create")
          .setCta()
          .onClick(() => {
            if (!this.childName) {
                new Notice("Child name is required.");
                return;
            }
            if (!this.parentFile) {
                new Notice("Valid parent note is required.");
                return;
            }
            this.close();
            this.onSubmit(this.childName, this.parentFile);
          })
      );
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