
import { App, Modal, Setting, Notice } from "obsidian";
import AbstractFolderPlugin from "main";
import { LibraryManager } from "../../library/git/library-manager";

export class JoinSharedSpaceModal extends Modal {
    plugin: AbstractFolderPlugin;
    libraryManager: LibraryManager;
    repoUrl: string = "";
    spaceName: string = "";

    constructor(app: App, plugin: AbstractFolderPlugin) {
        super(app);
        this.plugin = plugin;
        this.libraryManager = plugin.libraryManager;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl("h2", { text: "Join Shared Space" });
        contentEl.createEl("p", { text: "Clone an existing shared space from a Git repository to collaborate with others or contribute libraries you maintain." });

        new Setting(contentEl)
            .setName("Repository URL")
            .setDesc("The Git URL of the shared space (HTTPS)")
            .addText((text) =>
                text
                    .setPlaceholder("https://github.com/username/project.git")
                    .onChange((value) => {
                        this.repoUrl = value.trim();
                        // Auto-suggest name from URL if empty
                        if (this.repoUrl && !this.spaceName) {
                            try {
                                const parts = this.repoUrl.split('/');
                                const lastPart = parts[parts.length - 1];
                                this.spaceName = lastPart.replace('.git', '');
                                // Ideally update the spaceName input field too, but we need a reference to it.
                                // For simplicity, we just set the internal state.
                            } catch (e) {
                                // ignore
                            }
                        }
                    })
            );

        new Setting(contentEl)
            .setName("Space Name")
            .setDesc("Local folder name for this space")
            .addText((text) =>
                text
                    .setPlaceholder("project-name")
                    .onChange((value) => {
                        this.spaceName = value;
                    })
            );

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Join Space")
                    .setCta()
                    .onClick(async () => {
                        if (!this.repoUrl) {
                            new Notice("Please enter a repository URL");
                            return;
                        }
                        if (!this.spaceName) {
                            // Try to derive again if still empty
                             try {
                                const parts = this.repoUrl.split('/');
                                const lastPart = parts[parts.length - 1];
                                this.spaceName = lastPart.replace('.git', '');
                            } catch (e) {
                                new Notice("Please enter a space name");
                                return;
                            }
                        }
                        
                        await this.joinSpace();
                        this.close();
                    })
            );
    }

    async joinSpace() {
        const spacesRoot = this.plugin.settings.librarySettings.sharedSpacesRoot || "Abstract Spaces";
        const path = `${spacesRoot}/${this.spaceName}`;

        try {
            // Ensure root exists
            if (!this.app.vault.getAbstractFileByPath(spacesRoot)) {
                await this.app.vault.createFolder(spacesRoot);
            }

            // Check if space exists
            if (this.app.vault.getAbstractFileByPath(path)) {
                new Notice(`Folder ${path} already exists!`);
                return;
            }

            new Notice(`Cloning ${this.repoUrl} to ${path}...`);
            
            // Clone
            await this.libraryManager.cloneSpace(this.repoUrl, path);
            
            // Add to settings
            if (!this.plugin.settings.librarySettings.sharedSpaces) {
                this.plugin.settings.librarySettings.sharedSpaces = [];
            }
            if (!this.plugin.settings.librarySettings.sharedSpaces.includes(path)) {
                this.plugin.settings.librarySettings.sharedSpaces.push(path);
                await this.plugin.saveSettings();
            }

            new Notice("Successfully joined shared space!");
            
            // Start sync engine immediately
            await this.libraryManager.startSyncEngine(path);
            new Notice("Sync engine active for space");
            
            // Visual refresh
            this.plugin.graphEngine.forceReindex();
            this.app.workspace.trigger("abstract-folder:spaces-updated");

        } catch (e) {
            new Notice("Failed to join space: " + e.message);
            console.error(e);
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
