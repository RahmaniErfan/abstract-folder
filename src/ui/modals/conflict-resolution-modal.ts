import { App, Modal, Setting, Notice } from "obsidian";

export class ConflictResolutionModal extends Modal {
    constructor(
        app: App,
        private vaultPath: string,
        private files: string[],
        private onResolve: (strategy: 'overwrite' | 'cancel') => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("af-conflict-modal");

        contentEl.createEl("h2", { text: "Git Conflict Detected" });
        
        contentEl.createEl("p", { 
            text: `Your local changes to the following files would be overwritten by the remote updates:`,
            cls: "af-conflict-desc"
        });

        const list = contentEl.createDiv({ cls: "af-conflict-list" });
        this.files.forEach(file => {
            list.createDiv({ text: `• ${file}`, cls: "af-conflict-item" });
        });

        contentEl.createEl("p", { 
            text: "Would you like to overwrite your local changes with the remote version, or cancel the sync?",
            cls: "af-conflict-question"
        });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText("Overwrite Local Changes")
                .setWarning()
                .onClick(() => {
                    this.onResolve('overwrite');
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText("Cancel")
                .onClick(() => {
                    this.onResolve('cancel');
                    this.close();
                }));
    }

    onClose() {
        this.contentEl.empty();
    }
}
