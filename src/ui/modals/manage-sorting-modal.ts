import { App, Modal, Setting } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import { Group, SortBy, SortConfig } from "../../types";
import { ContextEngine } from "../../core/context-engine";
import type AbstractFolderPlugin from "main";

export class ManageSortingModal extends Modal {
  private contextEngine: ContextEngine;
  private plugin: AbstractFolderPlugin;
  private groups: Group[];
  private defaultSort: SortConfig;

  constructor(app: App, contextEngine: ContextEngine, plugin: AbstractFolderPlugin) {
    super(app);
    this.contextEngine = contextEngine;
    this.plugin = plugin;
    this.groups = this.contextEngine.getGroups(); // Already filtered by scope
    
    // Get current scope's default sort
    const scope = this.contextEngine.getScope();
    const scopeConfig = this.plugin.settings.scopes[scope];
    this.defaultSort = scopeConfig ? { ...scopeConfig.sort } : { sortBy: 'name', sortOrder: 'asc' };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Manage default sorting" });
    contentEl.createEl("p", { text: `Set the default sorting options for the '${this.contextEngine.getScope()}' scope and for each group.` });

    // Main Default View Sorting
    contentEl.createEl("h3", { text: "Scope Default" });
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
        // Initialize group sort if it doesn't exist
        if (!group.sort) {
            group.sort = { sortBy: 'name', sortOrder: 'asc' };
        }
        
        this.createSortSetting(groupsContainer, group.name, group.sort, (newSort) => {
             // We update the local object (reference from getGroups which is settings reference? no getGroups returns filtered array)
             // Wait, settings.groups in contextEngine returns reference to objects in settings.groups array?
             // Yes, array.filter returns new array but objects are references.
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
            .addOption("ctime", "Created time")
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

  async saveSettings() {
    // 1. Save scope default sort
    const scope = this.contextEngine.getScope();
    if (this.plugin.settings.scopes[scope]) {
        this.plugin.settings.scopes[scope].sort = this.defaultSort;
        // Also update context engine state if it's the active sort and no group is active? 
        // ContextEngine.setSortConfig updates state and settings.
        // Here we act as a bulk update.
        if (!this.contextEngine.getState().activeGroupId) {
            this.contextEngine.setSortConfig(this.defaultSort);
        }
    }

    // 2. Save Groups (references were modified directly in onOpen logic)
    // contextEngine.getGroups() returned references to objects in settings.groups.
    // So modifications to group.sort are already reflected in the objects in settings.groups.
    // We just need to persist settings.
    await this.plugin.saveSettings();
    
    // If active group was modified, we should update context engine?
    const activeGroupId = this.contextEngine.getState().activeGroupId;
    if (activeGroupId) {
        const activeGroup = this.groups.find(g => g.id === activeGroupId);
        if (activeGroup && activeGroup.sort) {
            this.contextEngine.setSortConfig(activeGroup.sort);
        }
    }

    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
