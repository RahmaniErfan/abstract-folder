import { App, Modal, Setting } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import { Group } from "../../types";
import { CreateEditGroupModal } from "./create-edit-group-modal";

export class ManageGroupsModal extends Modal {
  private settings: AbstractFolderPluginSettings;
  private onSave: (groups: Group[], activeGroupId: string | null) => void;
  private groups: Group[];
  private activeGroupId: string | null;

  constructor(app: App, settings: AbstractFolderPluginSettings, onSave: (groups: Group[], activeGroupId: string | null) => void) {
    super(app);
    this.settings = settings;
    this.onSave = onSave;
    this.groups = [...settings.groups]; // Work on a copy
    this.activeGroupId = settings.activeGroupId;
  }

  onOpen() {
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

    this.groups.forEach((group, index) => {
      const isActive = this.activeGroupId === group.id;
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
      }

      // Make the whole row clickable
      groupSetting.settingEl.addEventListener("click", (e) => {
        // Only trigger if we didn't click a button
        if (e.target instanceof HTMLElement && e.target.closest("button")) {
          return;
        }
        
        this.activeGroupId = isActive ? null : group.id;
        this.saveAndRerender();
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
          this.deleteGroup(index);
        }));
    });
  }

  createGroup() {
    new CreateEditGroupModal(this.app, this.settings, null, (newGroup) => {
      this.groups.push(newGroup);
      this.saveAndRerender();
    }).open();
  }

  editGroup(group: Group) {
    new CreateEditGroupModal(this.app, this.settings, group, (updatedGroup) => {
      const index = this.groups.findIndex(g => g.id === updatedGroup.id);
      if (index !== -1) {
        this.groups[index] = updatedGroup;
        this.saveAndRerender();
      }
    }).open();
  }

  deleteGroup(index: number) {
    const groupToDelete = this.groups[index];
    if (this.activeGroupId === groupToDelete.id) {
        this.activeGroupId = null; // Clear active group if deleted
    }
    this.groups.splice(index, 1);
    this.saveAndRerender();
  }

  private saveAndRerender() {
    this.onSave(this.groups, this.activeGroupId);
    this.close();
    this.open();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}