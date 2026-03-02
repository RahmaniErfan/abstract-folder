import { App, Modal } from "obsidian";
import AbstractFolderPlugin from "main";
import { UnifiedDashboardView } from "../components/unified-dashboard-view";

export class AbstractDashboardModal extends Modal {
    constructor(
        app: App,
        private plugin: AbstractFolderPlugin,
        private vaultPath: string,
        private name: string,
        private isOwner: boolean
    ) {
        super(app);
        this.modalEl.addClass("af-unified-dashboard-modal");
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl("h2", { text: `Dashboard: ${this.name}` });
        
        new UnifiedDashboardView(
            contentEl,
            this.app,
            this.plugin,
            this.vaultPath,
            this.isOwner,
            this.name,
            () => this.close()
        );
    }

    onClose() {
        this.contentEl.empty();
    }
}
