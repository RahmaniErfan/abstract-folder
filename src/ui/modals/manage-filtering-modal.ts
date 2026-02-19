import { App, Modal, Setting } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import { Group, FilterConfig } from "../../types";
import { ContextEngine } from "../../core/context-engine";
import type AbstractFolderPlugin from "main";

export class ManageFilteringModal extends Modal {
  private contextEngine: ContextEngine;
  private plugin: AbstractFolderPlugin;
  private groups: Group[];
  private defaultFilter: FilterConfig;

  constructor(app: App, contextEngine: ContextEngine, plugin: AbstractFolderPlugin) {
    super(app);
    this.contextEngine = contextEngine;
    this.plugin = plugin;
    this.groups = this.contextEngine.getGroups(); // Already filtered by scope
    
    // Get current scope's default filter
    const scope = this.contextEngine.getScope();
    const scopeConfig = this.plugin.settings.scopes[scope];
    this.defaultFilter = scopeConfig ? { ...scopeConfig.filter } : { excludeExtensions: [] };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Manage default filtering" });
    contentEl.createEl("p", { text: `Set the default filtering options for the '${this.contextEngine.getScope()}' scope and for each group. Enter extensions separated by commas.` });

    // Main Default View Filtering
    contentEl.createEl("h3", { text: "Scope Default" });
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

  async saveSettings() {
    // 1. Save scope default filter
    const scope = this.contextEngine.getScope();
    if (this.plugin.settings.scopes[scope]) {
        this.plugin.settings.scopes[scope].filter = this.defaultFilter;
        // Update context engine if this is the active filter?
        // setFilter takes a string query, not FilterConfig.
        // The ContextEngine uses settings.scopes[scope].filter implicitly? 
        // No, ContextEngine state has activeFilter (search query).
        // The defaultFilter is used by TreeBuilder or GraphEngine options probably.
    }

    // 2. Save Groups (modified references)
    await this.plugin.saveSettings();
    
    // Trigger graph update
    // @ts-ignore
    this.app.workspace.trigger('abstract-folder:graph-updated');

    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
