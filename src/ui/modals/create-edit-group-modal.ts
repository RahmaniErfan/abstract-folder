import { App, Modal, Setting, Notice, normalizePath } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import { Group } from "../../types";
import { PathInputSuggest } from "../settings/sections/general";
import type AbstractFolderPlugin from "main";

export class CreateEditGroupModal extends Modal {
  private settings: AbstractFolderPluginSettings;
  private existingGroup: Group | null;
  private onSubmit: (group: Group) => void;
  private plugin: AbstractFolderPlugin;

  private groupId: string;
  private groupName: string;
  private parentFolders: string[];
  private newParentFolderInput: HTMLInputElement | null = null;

  constructor(app: App, settings: AbstractFolderPluginSettings, existingGroup: Group | null, onSubmit: (group: Group) => void, plugin: AbstractFolderPlugin) {
    super(app);
    this.plugin = plugin;
    this.settings = settings;
    this.existingGroup = existingGroup;
    this.onSubmit = onSubmit;

    if (existingGroup) {
      this.groupId = existingGroup.id;
      this.groupName = existingGroup.name;
      this.parentFolders = [...existingGroup.parentFolders];
    } else {
      this.groupId = this.generateId();
      this.groupName = "";
      this.parentFolders = [];
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.existingGroup ? "Edit Group" : "Create New Group" });

    new Setting(contentEl)
      .setName("Group name")
      .addText(text => text
        .setPlaceholder("Example: work projects")
        .setValue(this.groupName)
        .onChange(value => this.groupName = value));

    this.renderParentFolders(contentEl);

    new Setting(contentEl)
      .addButton(button => button
        .setButtonText(this.existingGroup ? "Save Group" : "Create Group")
        .setCta()
        .onClick(() => this.submit()))
      .addButton(button => button
        .setButtonText("Cancel")
        .onClick(() => this.close()));
  }

  renderParentFolders(containerEl: HTMLElement) {
    containerEl.createEl("h3", { text: "Included parent notes" });
    const folderListEl = containerEl.createDiv({ cls: "abstract-folder-group-folders" });

    if (this.parentFolders.length === 0) {
      folderListEl.createEl("p", { text: "No parent notes added yet." });
    } else {
      this.parentFolders.forEach((folder, index) => {
        new Setting(folderListEl)
          .setClass("abstract-folder-group-folder-item")
          .addText(text => text
            .setValue(folder)
            .setDisabled(true))
          .addButton(button => button
            .setIcon("trash")
            .setTooltip("Remove note")
            .onClick(() => {
              this.parentFolders.splice(index, 1);
              this.close(); this.open(); // Re-render the modal to update the list
            }));
      });
    }

    new Setting(containerEl)
      .setName("Add parent note")
      .setDesc("Enter the full path of a note (.md) to include as a root parent (e.g., 'Notes/Parent.md'). The view will show this note and its children.")
      .addText(text => {
        this.newParentFolderInput = text.inputEl;
        new PathInputSuggest(this.plugin, text.inputEl); // Use PathInputSuggest
        text.setPlaceholder("Note path (e.g. folder/note.md)")
          .onChange(value => {
            // No direct update here, wait for add button or enter
          });
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            this.addParentFolder(text.getValue());
            text.setValue(""); // Clear input after adding
          }
        });
      })
      .addButton(button => button
        .setIcon("plus")
        .setTooltip("Add note")
        .onClick(() => {
          if (this.newParentFolderInput) {
            this.addParentFolder(this.newParentFolderInput.value);
            this.newParentFolderInput.value = ""; // Clear input after adding
          }
        }));
  }

  addParentFolder(folderPath: string) {
    const normalizedPath = normalizePath(folderPath).trim();
    if (normalizedPath && !this.parentFolders.includes(normalizedPath)) {
      this.parentFolders.push(normalizedPath);
      this.close(); this.open(); // Re-render to show the new folder
    } else if (this.parentFolders.includes(normalizedPath)) {
        new Notice("This note is already in the list.");
    }
  }

  submit() {
    if (!this.groupName) {
      new Notice("Group name cannot be empty.");
      return;
    }

    // Attempt to add any pending path in the input field before submitting
    if (this.newParentFolderInput && this.newParentFolderInput.value) {
      // Temporarily store the value to avoid issues with this.close()/this.open()
      const pendingPath = this.newParentFolderInput.value;
      this.addParentFolder(pendingPath);
    }

    const group: Group = {
      id: this.groupId,
      name: this.groupName,
      parentFolders: this.parentFolders,
    };
    this.onSubmit(group);
    this.close();
  }

  generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}