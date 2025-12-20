import { App, Modal, Setting } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import { Group, SortBy, SortConfig } from "../../types";

export class ManageSortingModal extends Modal {
  private settings: AbstractFolderPluginSettings;
  private onSave: (updatedSettings: AbstractFolderPluginSettings) => void;
  private groups: Group[];
  private defaultSort: SortConfig;

  constructor(app: App, settings: AbstractFolderPluginSettings, onSave: (updatedSettings: AbstractFolderPluginSettings) => void) {
    super(app);
    this.settings = settings;
    this.onSave = onSave;
    this.groups = JSON.parse(JSON.stringify(settings.groups)) as Group[]; // Work on a deep copy
    this.defaultSort = { ...settings.defaultSort }; // Work on a copy
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Manage default sorting" });
    contentEl.createEl("p", { text: "Set the default sorting options for the main view and for each group. These settings will be applied when you switch to the group or reset the view." });

    // Main Default View Sorting
    contentEl.createEl("h3", { text: "Default view" });
    const defaultViewContainer = contentEl.createDiv({ cls: "abstract-folder-sort-container" });
    this.createSortSetting(defaultViewContainer, "Default view", this.defaultSort, (newSort) => {
        this.defaultSort = newSort;
    });

    contentEl.createEl("hr");

    // Groups Sorting
    contentEl.createEl("h3", { text: "Groups" });
    const groupsContainer = contentEl.createDiv({ cls: "abstract-folder-sort-container" });
    
    if (this.groups.length === 0) {
      groupsContainer.createEl("p", { text: "No groups defined." });
    } else {
      this.groups.forEach((group) => {
        // Initialize group sort if it doesn't exist, defaulting to 'name' 'asc'
        if (!group.sort) {
            group.sort = { sortBy: 'name', sortOrder: 'asc' };
        }
        
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.createSortSetting(groupsContainer, group.name, group.sort, (newSort) => {
             group.sort = newSort;
        });
      });
    }

    new Setting(contentEl)
      .addButton(button => button
        .setButtonText("Save")
        .setCta()
        .onClick(() => {
          this.saveSettings();
        }))
      .addButton(button => button
        .setButtonText("Cancel")
        .onClick(() => {
          this.close();
        }));
  }

  createSortSetting(container: HTMLElement, name: string, currentSort: SortConfig, onChange: (sort: SortConfig) => void) {
    new Setting(container)
        .setName(name)
        .setDesc("Sort by")
        .addDropdown(dropdown => dropdown
            .addOption("name", "Name")
            .addOption("mtime", "Modified time")
            .addOption("thermal", "Thermal")
            .addOption("rot", "Stale rot")
            .addOption("gravity", "Gravity")
            .setValue(currentSort.sortBy)
            .onChange((value) => {
                currentSort.sortBy = value as SortBy;
                onChange(currentSort);
            })
        )
        .addDropdown(dropdown => dropdown
            .addOption("asc", "Ascending")
            .addOption("desc", "Descending")
            .setValue(currentSort.sortOrder)
            .onChange((value) => {
                currentSort.sortOrder = value as 'asc' | 'desc';
                onChange(currentSort);
            })
        );
  }

  saveSettings() {
    // Update the main settings object with the local changes
    const newSettings = {
        ...this.settings,
        groups: this.groups,
        defaultSort: this.defaultSort
    };
    this.onSave(newSettings);
    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
