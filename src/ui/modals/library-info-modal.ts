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

        contentEl.createEl("h2", { text: "Library Catalog & Libraries", cls: "af-modal-title" });

        const container = contentEl.createDiv({ cls: "af-info-container" });

        // 1. Catalog vs Library
        this.renderSection(container, "Catalog vs Library", "library", 
            "A Catalog is a curated collection of Libraries. The official catalog is managed by Abstract Folder and includes a network of libraries contributed by the maintainers or the community.");

        // 2. Standalone & Unofficial
        this.renderSection(container, "Standalone & Unofficial", "info", 
            "Both catalogs and libraries can be standalone (unofficial). You can maintain your own catalog and allow others to add their libraries to it. A catalog simply consists of a configuration file with links to libraries and their specific details.");

        // 3. Catalog Management
        this.renderSection(container, "GitHub-Based Management", "github", 
            "Managing your own catalog must be done through GitHub; it cannot be managed directly through Obsidian. This ensures that the directory remains structured and easily accessible for contributors and users alike.");

        // 4. Contribution & Syncing
        this.renderSection(container, "Contribution & Syncing", "git-branch", 
            "If you are a contributor to a library, you can easily add it to Abstract Spaces and update things there. Once your library is added to a catalog (such as the official one), other people will sync and see your changes automatically.");

        // 5. Security & Safety
        this.renderSection(container, "Security & Catalog Filtering", "shield-check", 
            "To ensure vault safety, catalogs enforce strict security policies:\n" +
            "• Only specific file types are accepted.\n" +
            "• Unaccepted files or Dataview scripts are filtered out during pull operations to prevent malicious code execution.\n" +
            "• Content is scanned for safety before merging.");

        // 6. Content Safety & Blacklisting
        this.renderSection(container, "Safety Enforcement", "alert-octagon", 
            "Abstract Folder has a zero-tolerance policy for harmful content (NSFW, illegal, or malicious). Violators will be:\n" +
            "• Permanently blacklisted in the global catalog.\n" +
            "• If harmful content is added to a catalog—even by accident—the entire catalog will be removed and all responsible parties blacklisted.\n" +
            "Maintenance is critical to protecting the community.");

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
