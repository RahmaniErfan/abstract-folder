import { App, Modal, Setting } from "obsidian";
import { Group } from "../../types";
import { CreateEditGroupModal } from "./create-edit-group-modal";
import type AbstractFolderPlugin from "main";
import { ContextEngine } from "../../core/context-engine";

export class ManageGroupsModal extends Modal {
  private contextEngine: ContextEngine;
  private groups: Group[];
  private activeGroupId: string | null;
  private plugin: AbstractFolderPlugin;

  constructor(app: App, contextEngine: ContextEngine, plugin: AbstractFolderPlugin) {
    super(app);
    this.plugin = plugin;
    this.contextEngine = contextEngine;
    this.groups = this.contextEngine.getGroups();
    this.activeGroupId = this.contextEngine.getState().activeGroupId;
  }

  onOpen() {
    // Refresh data on open
    this.groups = this.contextEngine.getGroups();
    this.activeGroupId = this.contextEngine.getState().activeGroupId;

    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Manage groups" });
    contentEl.createEl("p", { text: "Click on a group to activate or deactivate it.", cls: "abstract-folder-setting-instruction" });

    this.renderGroupList(contentEl);

    new Setting(contentEl)
      .addButton(button => button
        .setButtonText("Add new group")
        .setCta()
        .onClick(() => {
          this.createGroup();
        }))
      .addButton(button => button
        .setButtonText("Close")
        .onClick(() => {
          this.close();
        }));
  }

  renderGroupList(containerEl: HTMLElement) {
    const groupsContainer = containerEl.createDiv({ cls: "abstract-folder-groups-container" });
    if (this.groups.length === 0) {
      groupsContainer.createEl("p", { text: "No groups defined yet." });
      return;
    }

    this.groups.forEach((group) => {
      const isActive = this.activeGroupId === group.id;
      // console.log(`[Abstract Folder] Modal: Rendering group ${group.name} (id: ${group.id}), activeGroupId: ${this.activeGroupId}, isActive: ${isActive}`);
      
      const groupSetting = new Setting(groupsContainer)
        .setName(group.name)
        .setDesc(`Folders: ${group.parentFolders.join(", ")}`)
        .setClass("abstract-folder-group-item");

      if (isActive) {
        groupSetting.settingEl.addClass("is-active");
        
        // Add indicator dot at the start of the name
        const dot = document.createElement("span");
        dot.addClass("abstract-folder-active-dot");
        groupSetting.nameEl.prepend(dot);

        // Add "Activated" badge
        const badge = groupSetting.nameEl.createEl("span", { 
            text: " (Activated)", 
            cls: "abstract-folder-active-badge" 
        });
        badge.style.color = "var(--interactive-accent)";
        badge.style.fontSize = "var(--font-ui-smaller)";
        badge.style.marginLeft = "4px";
      }

      // Make the whole row clickable
      groupSetting.settingEl.addEventListener("click", (e) => {
        // Only trigger if we didn't click a button
        if (e.target instanceof HTMLElement && e.target.closest("button")) {
          return;
        }
        
        const newActiveId = isActive ? null : group.id;
        this.contextEngine.setActiveGroup(newActiveId);
        this.activeGroupId = newActiveId;
        this.refresh();
      });

      groupSetting.addButton(button => button
        .setIcon("edit")
        .setTooltip("Edit group")
        .onClick(() => {
          this.editGroup(group);
        }));

      groupSetting.addButton(button => button
        .setIcon("trash")
        .setTooltip("Delete group")
        .onClick(() => {
          this.deleteGroup(group.id);
        }));
    });
  }

  createGroup() {
    new CreateEditGroupModal(this.app, this.plugin.settings, null, async (newGroup) => {
        await this.contextEngine.createGroup(newGroup.name, newGroup.parentFolders, newGroup.sort, newGroup.filter);
        this.refresh();
    }, this.plugin, this.contextEngine.getScope()).open();
  }

  editGroup(group: Group) {
    new CreateEditGroupModal(this.app, this.plugin.settings, group, async (updatedGroup) => {
        await this.contextEngine.updateGroup(group.id, {
            name: updatedGroup.name,
            parentFolders: updatedGroup.parentFolders,
            sort: updatedGroup.sort,
            filter: updatedGroup.filter
        });
        this.refresh();
    }, this.plugin, group.scope).open();
  }

  async deleteGroup(groupId: string) {
    await this.contextEngine.deleteGroup(groupId);
    this.refresh();
  }

  private refresh() {
    this.groups = this.contextEngine.getGroups();
    this.activeGroupId = this.contextEngine.getState().activeGroupId;
    this.onOpen(); 
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}