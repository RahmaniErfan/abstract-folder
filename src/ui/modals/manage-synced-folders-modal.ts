import { App, Modal, Setting, TFile, Notice } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import { FolderIndexer } from "../../indexer";
import { FolderSelectionModal } from "../modals";
import { updateFileIcon } from "../../utils/file-operations";
import { CreateSyncedFolderModal } from "./create-synced-folder-modal";

export class ManageSyncedFoldersModal extends Modal {
  private settings: AbstractFolderPluginSettings;
  private indexer: FolderIndexer;

  constructor(app: App, settings: AbstractFolderPluginSettings, indexer: FolderIndexer) {
    super(app);
    this.settings = settings;
    this.indexer = indexer;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Manage synced folders" });
    
    contentEl.createEl("p", {
        text: "These are Abstract Files that are synced to Physical Folders. Creating a file under the abstract node will physically place it in the synced folder.",
        cls: "setting-item-description"
    });

    this.renderSyncList(contentEl);

    new Setting(contentEl)
      .addButton(button => button
        .setButtonText("Add new sync")
        .setCta()
        .onClick(() => {
            this.close();
            new CreateSyncedFolderModal(this.app, this.settings, this.indexer, () => {
                new ManageSyncedFoldersModal(this.app, this.settings, this.indexer).open();
            }).open();
        }))
      .addButton(button => button
        .setButtonText("Close")
        .onClick(() => {
          this.close();
        }));
  }

  renderSyncList(containerEl: HTMLElement) {
    const syncMap = this.indexer.getAllSyncedFolders();
    const listContainer = containerEl.createDiv({ cls: "abstract-folder-sync-list" });

    if (syncMap.size === 0) {
      listContainer.createEl("p", { text: "No synced folders defined yet." });
      return;
    }

    // syncMap is Physical Path -> Abstract File Path
    syncMap.forEach((abstractPath, physicalPath) => {
        const abstractFile = this.app.vault.getAbstractFileByPath(abstractPath);
        const abstractName = abstractFile ? abstractFile.name : abstractPath;
        
        const setting = new Setting(listContainer)
            .setName(abstractName)
            .setDesc(`Synced to: ${physicalPath}`)
            .addButton(button => button
                .setIcon("trash")
                .setTooltip("Remove sync")
                .onClick(async () => {
                    await this.removeSync(abstractPath);
                    this.onOpen(); // Re-render
                })
            );
    });
  }

  async removeSync(abstractPath: string) {
      const file = this.app.vault.getAbstractFileByPath(abstractPath);
      if (file instanceof TFile) {
          await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
              delete frontmatter[this.settings.syncPropertyName];
          });
          new Notice(`Removed sync from ${file.basename}`);
          this.indexer.rebuildGraphAndTriggerUpdate();
      }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}