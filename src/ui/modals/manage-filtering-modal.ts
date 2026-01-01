import { App, Modal, Setting } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import { Group, FilterConfig } from "../../types";

export class ManageFilteringModal extends Modal {
  private settings: AbstractFolderPluginSettings;
  private onSave: (updatedSettings: AbstractFolderPluginSettings) => void;
  private groups: Group[];
  private defaultFilter: FilterConfig;

  constructor(app: App, settings: AbstractFolderPluginSettings, onSave: (updatedSettings: AbstractFolderPluginSettings) => void) {
    super(app);
    this.settings = settings;
    this.onSave = onSave;
    this.groups = JSON.parse(JSON.stringify(settings.groups)) as Group[]; // Work on a deep copy
    this.defaultFilter = { ...settings.defaultFilter }; // Work on a copy
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Manage default filtering" });
    contentEl.createEl("p", { text: "Set the default filtering options for the main view and for each group. Enter extensions separated by commas." });

    // Main Default View Filtering
    contentEl.createEl("h3", { text: "Default view" });
    const defaultViewContainer = contentEl.createDiv({ cls: "abstract-folder-filter-container" });
    this.createFilterSetting(defaultViewContainer, "Default view", this.defaultFilter, (newFilter) => {
        this.defaultFilter = newFilter;
    });

    contentEl.createEl("hr");

    // Groups Filtering
    contentEl.createEl("h3", { text: "Groups" });
    const groupsContainer = contentEl.createDiv({ cls: "abstract-folder-filter-container" });
    
    if (this.groups.length === 0) {
      groupsContainer.createEl("p", { text: "No groups defined." });
    } else {
      this.groups.forEach((group) => {
        if (!group.filter) {
            group.filter = { excludeExtensions: [] };
        }
        
        this.createFilterSetting(groupsContainer, group.name, group.filter, (newFilter) => {
             group.filter = newFilter;
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

  createFilterSetting(container: HTMLElement, name: string, currentFilter: FilterConfig, onChange: (filter: FilterConfig) => void) {
    new Setting(container)
        .setName(name)
        .setDesc("Exclude extensions")
        .addText(text => text
            .setPlaceholder("PNG, JPG, etc")
            .setValue(currentFilter.excludeExtensions.join(", "))
            .onChange((value) => {
                currentFilter.excludeExtensions = value.split(",")
                    .map(ext => ext.trim().toLowerCase())
                    .filter(ext => ext !== "");
                onChange(currentFilter);
            })
        );
  }

  saveSettings() {
    this.settings.groups = this.groups;
    this.settings.defaultFilter = this.defaultFilter;
    
    this.onSave(this.settings);
    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
