import { App, Modal, Setting, TFile, Notice, EventRef } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import { FolderIndexer } from "../../indexer";
import { AbstractFolderFrontmatter } from "../../types";
import { CreateSyncedFolderModal } from "./create-synced-folder-modal";

export class ManageSyncedFoldersModal extends Modal {
  private settings: AbstractFolderPluginSettings;
  private indexer: FolderIndexer;
  private eventRef: EventRef | null = null;

  constructor(app: App, settings: AbstractFolderPluginSettings, indexer: FolderIndexer) {
    super(app);
    this.settings = settings;
    this.indexer = indexer;
  }

  onOpen() {
    this.render();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    this.eventRef = (this.app.workspace as any).on('abstract-folder:graph-updated', () => {
        this.render();
    }) as EventRef;
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Manage synced folders" });
    
    contentEl.createEl("p", {
        text: "These are abstract files that are synced to physical folders. Creating a file under the abstract node will physically place it in the synced folder.",
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
        
        new Setting(listContainer)
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
          await this.app.fileManager.processFrontMatter(file, (frontmatter: AbstractFolderFrontmatter) => {
              delete frontmatter[this.settings.syncPropertyName];
          });
          new Notice(`Removed sync from ${file.basename}`);
          this.indexer.rebuildGraphAndTriggerUpdate();
      }
  }

  onClose() {
    if (this.eventRef) {
        this.app.workspace.offref(this.eventRef);
        this.eventRef = null;
    }
    const { contentEl } = this;
    contentEl.empty();
  }
}