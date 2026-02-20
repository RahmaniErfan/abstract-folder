import { App, Modal, setIcon } from "obsidian";

export class LibraryInfoModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.addClass("af-library-info-modal-container");
        contentEl.addClass("af-library-info-modal");

        contentEl.createEl("h2", { text: "Libraries & Catalogs", cls: "af-modal-title" });

        const container = contentEl.createDiv({ cls: "af-info-container" });

        // 1. Overview
        this.renderSection(container, "Community-Driven Knowledge", "library", 
            "A Catalog is a curated collection of Libraries. Libraries are community-driven knowledge bases that work similarly to Obsidian's community plugins but for structured data and curated knowledge.");

        // 2. Contribution Flow
        this.renderSection(container, "How to Contribute", "git-pull-request", 
            "If you want to add a knowledge base (e.g., cooking, software engineering, biology), follow these steps:\n" +
            "1. Fork the official catalog repository.\n" +
            "2. Add your library information to the directory index (`directory.json`).\n" +
            "3. Submit a Pull Request (PR) for review.\n" +
            "Once reviewed and accepted, your library will be available to all users of that catalog.");

        // 3. Security Section
        this.renderSection(container, "Security & Catalog Filtering", "shield-check", 
            "To ensure vault safety, catalogs enforce strict security policies:\n" +
            "• Only specific file types are accepted.\n" +
            "• Unaccepted files or Dataview scripts are filtered out during pull operations to prevent malicious code execution.\n" +
            "• Content is scanned for safety before merging.");

        // 4. Content Safety & Blacklisting
        this.renderSection(container, "Safety Enforcement", "alert-octagon", 
            "Abstract Folder has a zero-tolerance policy for harmful content (NSFW, illegal, or malicious). Violators will be:\n" +
            "• Permanently blacklisted in the global catalog.\n" +
            "• If harmful content is added to a catalog—even by accident—the entire catalog will be removed and all responsible parties blacklisted.\n" +
            "Maintenance is critical to protecting the community.");

        // 5. Creating & Using Catalogs
        this.renderSection(container, "Catalog Management", "plus-circle", 
            "You can contribute to the official catalog or add your own unofficial catalogs:\n" +
            "1. To create a catalog, use the official Catalog Template.\n" +
            "2. Submit a PR to the main catalog system to be officially listed.\n" +
            "3. Alternatively, users can add custom catalog URLs in settings.\n" +
            "Write access to any catalog is strictly limited to its verified maintainers. Maintainers are fully responsible for all merged content; others contribute via PRs.");

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
