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

export async function createAbstractChildFile(app: App, settings: AbstractFolderPluginSettings, childName: string, parentFile: TFile, childType: ChildFileType) {
    const parentBaseName = parentFile.basename;
    const cleanParentName = parentBaseName.replace(/"/g, ''); // Ensure parent name is clean for frontmatter

    let fileExtension: string;
    let initialContent: string;

    switch (childType) {
        case 'note':
            fileExtension = '.md';
            // Markdown notes will have frontmatter and a heading
            initialContent = `---
${settings.propertyName}: "[[${cleanParentName}]]"
aliases:
  - ${childName}
---

# ${childName}
`;
            break;
        case 'canvas':
            fileExtension = '.canvas';
            // Minimal empty canvas structure
            initialContent = `{
  "nodes": [],
  "edges": []
}`;
            break;
        case 'base':
            fileExtension = '.base';
            // Minimal empty base structure (assuming JSON for now)
            initialContent = `{}`;
            break;
        default:
            new Notice(`Unsupported child type: ${childType}`);
            return;
    }
    
    // Generate a unique filename
    const safeChildName = childName.replace(/[\\/:*?"<>|]/g, "");
    let fileName = `${safeChildName}${fileExtension}`;
    let counter = 0;
    while (app.vault.getAbstractFileByPath(fileName)) {
        counter++;
        fileName = `${safeChildName} ${counter}${fileExtension}`;
    }

    try {
        const file = await app.vault.create(fileName, initialContent);
        new Notice(`Created: ${fileName}`);

        // Update parent's frontmatter to add this new file as a child
        await app.fileManager.processFrontMatter(parentFile, (frontmatter) => {
            const childrenPropertyName = settings.childrenPropertyName;
            let currentChildren = frontmatter[childrenPropertyName];

            if (!currentChildren) {
                currentChildren = [];
            } else if (typeof currentChildren === 'string') {
                currentChildren = [currentChildren];
            } else if (!Array.isArray(currentChildren)) {
                // If it's something unexpected, convert to array for safety
                console.warn(`Unexpected type for children property: ${typeof currentChildren}. Converting to array.`);
                currentChildren = [String(currentChildren)];
            }

            // Ensure the link is in wiki-link format for consistency, even for non-markdown files
            let childLink: string;
            if (file.extension === 'md') {
                childLink = `[[${file.basename}]]`; // Markdown files typically resolve by basename, alias handled by frontmatter
            } else {
                // For canvas/bases, use the full name (with extension) for the link
                // and optionally an alias for cleaner display.
                childLink = `[[${file.name}|${file.basename}]]`;
            }

            if (!currentChildren.includes(childLink)) {
                currentChildren.push(childLink);
            }
            frontmatter[childrenPropertyName] = currentChildren;
        });

        app.workspace.getLeaf(true).openFile(file);
        app.workspace.trigger('abstract-folder:graph-updated'); // Trigger graph update after modifying parent
    } catch (error) {
        new Notice(`Failed to create file: ${error}`);
        console.error(error);
    }
}

// Keep the old createChildNote for compatibility if it's used elsewhere,
// or decide to replace all usages with createAbstractChildFile.
// For now, I'll update it to use the new generic function.
export async function createChildNote(app: App, settings: AbstractFolderPluginSettings, childName: string, parentFile: TFile) {
    // This now just calls the generic function for a 'note' type
    await createAbstractChildFile(app, settings, childName, parentFile, 'note');
}