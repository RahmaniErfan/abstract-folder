import { App, Modal, Setting, Notice } from "obsidian";
import AbstractFolderPlugin from "main";
import { AuthService } from "../../library/services/auth-service";

export class LinkSharedSpaceModal extends Modal {
    private repositoryUrl: string = "";
    private autoCreate: boolean = true;
    private isPrivate: boolean = true;

    constructor(
        app: App, 
        private plugin: AbstractFolderPlugin,
        private spacePath: string,
        private spaceName: string,
        private onSuccess: () => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: `Publish "${this.spaceName}"` });
        contentEl.createEl("p", { 
            text: "This space is currently local-only. Publish it to GitHub to enable collaboration and backup." 
        });

        new Setting(contentEl)
            .setName("Auto-create repository")
            .setDesc("Automatically create a new repository on your GitHub account with the space name.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.autoCreate)
                    .onChange((value) => {
                        this.autoCreate = value;
                        this.renderContent();
                    })
            );

        this.renderContent();
    }

    private renderContent() {
        const container = this.contentEl.createDiv({ cls: "link-modal-dynamic-content" });
        // Clear previous dynamic content if any
        const existing = this.contentEl.querySelector(".link-modal-dynamic-content");
        if (existing) existing.remove();
        this.contentEl.appendChild(container);

        if (this.autoCreate) {
            new Setting(container)
                .setName("Private repository")
                .setDesc("If disabled, the repository will be public")
                .addToggle((toggle) =>
                    toggle
                        .setValue(this.isPrivate)
                        .onChange((value) => {
                            this.isPrivate = value;
                        })
                );
        } else {
            new Setting(container)
                .setName("Repository URL")
                .setDesc("The HTTPS URL of your existing GitHub repository")
                .addText((text) =>
                    text
                        .setPlaceholder("https://github.com/...")
                        .onChange((value) => {
                            this.repositoryUrl = value.trim();
                        })
                );
        }

        new Setting(container)
            .addButton((btn) =>
                btn
                    .setButtonText(this.autoCreate ? "Create & Publish" : "Link & Sync")
                    .setCta()
                    .onClick(async () => {
                        const token = this.plugin.settings.librarySettings.githubToken;
                        if (!token) {
                            new Notice("GitHub token missing. Please authenticate in settings.");
                            return;
                        }

                        try {
                            btn.setDisabled(true);
                            btn.setButtonText("Processing...");

                            let finalUrl = this.repositoryUrl;

                            if (this.autoCreate) {
                                // Sanitize name for GitHub (replace spaces with dashes)
                                const repoName = this.spaceName.toLowerCase().replace(/\s+/g, '-');
                                new Notice(`Creating repository "${repoName}"...`);
                                
                                const repo = await AuthService.createRepository(token, repoName, this.isPrivate);
                                if (!repo) {
                                    throw new Error("Failed to create repository on GitHub. Check your token permissions.");
                                }
                                finalUrl = repo.url;
                                new Notice("Repository created!");
                            }

                            if (!finalUrl || !finalUrl.startsWith("https://")) {
                                throw new Error("Invalid repository URL");
                            }

                            await this.plugin.libraryManager.addRemote(this.spacePath, finalUrl);
                            new Notice("Remote linked!");
                            
                            new Notice("Performing initial sync...");
                            await this.plugin.libraryManager.syncBackup(this.spacePath, "Initial publish to GitHub");
                            
                            this.onSuccess();
                            this.close();
                        } catch (e) {
                            new Notice(`Error: ${e.message}`);
                            btn.setDisabled(false);
                            btn.setButtonText(this.autoCreate ? "Create & Publish" : "Link & Sync");
                        }
                    })
            );
    }

    onClose() {
        this.contentEl.empty();
    }
}
