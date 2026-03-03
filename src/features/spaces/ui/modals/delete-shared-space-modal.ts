import { App, Modal, Setting, Notice } from "obsidian";
import AbstractFolderPlugin from "main";

export class DeleteSharedSpaceModal extends Modal {
    private deleteRemote: boolean = false;
    private hasRemote: boolean = false;

    constructor(
        app: App, 
        private plugin: AbstractFolderPlugin,
        private spacePath: string,
        private spaceName: string,
    ) {
        super(app);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: `Delete Space: ${this.spaceName}` });
        
        const warning = contentEl.createDiv({ cls: "af-delete-warning" });
        warning.createEl("p", { 
            text: "This will permanently remove the local folder and stop synchronization.",
            cls: "af-warning-text"
        });

        // Check if remote exists
        const remote = await this.plugin.libraryManager.getRemoteUrl(this.spacePath);
        this.hasRemote = !!remote;

        if (this.hasRemote) {
            new Setting(contentEl)
                .setName("Delete on GitHub")
                .setDesc("Also delete the associated repository on GitHub. (Requires 'delete_repo' token scope)")
                .addToggle((toggle) =>
                    toggle
                        .setValue(this.deleteRemote)
                        .onChange((value) => {
                            this.deleteRemote = value;
                        })
                );
        }

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Cancel")
                    .onClick(() => this.close())
            )
            .addButton((btn) =>
                btn
                    .setButtonText("Delete Permanently")
                    .setWarning()
                    .onClick(async () => {
                        btn.setDisabled(true);
                        btn.setButtonText("Deleting...");
                        try {
                            await this.plugin.libraryManager.deleteSharedSpace(this.spacePath, this.deleteRemote);
                            this.close();
                        } catch (e) {
                            new Notice(`Deletion failed: ${e.message}`);
                            btn.setDisabled(false);
                            btn.setButtonText("Delete Permanently");
                        }
                    })
            );
    }

    onClose() {
        this.contentEl.empty();
    }
}
