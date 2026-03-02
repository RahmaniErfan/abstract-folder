import { App, Modal, TFolder } from "obsidian";
import AbstractFolderPlugin from "main";
import { CollaboratorView } from "../components/collaborator-view";

export class CollaboratorModal extends Modal {
    constructor(
        app: App,
        private plugin: AbstractFolderPlugin,
        private vaultPath: string,
        private name: string,
        private isOwner: boolean
    ) {
        super(app);
        this.modalEl.addClass("af-collaborator-modal");
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl("h2", { text: `Collaborators: ${this.name}` });
        
        const wrapper = contentEl.createDiv({ cls: "af-collaborator-modal-wrapper" });
        new CollaboratorView(
            wrapper,
            this.app,
            this.plugin,
            this.vaultPath,
            this.isOwner
        );
    }

    onClose() {
        this.contentEl.empty();
    }
}
