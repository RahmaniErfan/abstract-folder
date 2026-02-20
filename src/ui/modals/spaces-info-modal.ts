import { App, Modal, setIcon } from "obsidian";

export class SpacesInfoModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.addClass("af-library-info-modal-container");
        contentEl.addClass("af-library-info-modal");

        contentEl.createEl("h2", { text: "Abstract Spaces", cls: "af-modal-title" });

        const container = contentEl.createDiv({ cls: "af-info-container" });

        // 1. Overview
        this.renderSection(container, "Collaborative Workspaces", "users", 
            "Abstract Spaces are dedicated Git repositories used for collaboration. They allow you to share structured knowledge, notes, or libraries with friends, family, or professional teams.");

        // 2. Adding Libraries
        this.renderSection(container, "Share Your Libraries", "library", 
            "As a contributor or a maintainer to a library in a public catalog, you can add your library here to directly make changes. This allows others who have the library installed to sync and view your updates immediately.");

        // 3. Coordination & Syncing
        this.renderSection(container, "Real-time Syncing", "refresh-cw", 
            "Spaces work by syncing local changes with a remote Git repository. When someone makes an update, you can simply pull the changes to see the latest version of the shared content.");

        // 4. Privacy & Access
        this.renderSection(container, "Flexible Collaboration", "shield", 
            "Whether it's a private family vault or a public community library, Spaces provide a structured way to manage who has access to what content through standard Git permissions.");

        const footer = contentEl.createDiv({ cls: "af-modal-footer" });
        const closeBtn = footer.createEl("button", { text: "Got it", cls: "mod-cta" });
        closeBtn.onclick = () => this.close();
    }

    private renderSection(container: HTMLElement, title: string, icon: string, text: string) {
        const section = container.createDiv({ cls: "af-info-section" });
        const header = section.createDiv({ cls: "af-info-section-header" });
        const iconEl = header.createDiv({ cls: "af-info-section-icon" });
        setIcon(iconEl, icon);
        header.createEl("h3", { text: title });

        const body = section.createDiv({ cls: "af-info-section-body" });
        const lines = text.split('\n');
        lines.forEach(line => {
            if (line.trim().startsWith('•')) {
                body.createEl("li", { text: line.replace('•', '').trim() });
            } else {
                body.createEl("p", { text: line });
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
