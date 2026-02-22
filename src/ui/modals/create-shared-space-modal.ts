
import { App, Modal, Setting, Notice, TFolder } from "obsidian";
import AbstractFolderPlugin from "main";
import { LibraryManager } from "../../library/git/library-manager";
import { AuthService } from "../../library/services/auth-service";

export class CreateSharedSpaceModal extends Modal {
    plugin: AbstractFolderPlugin;
    libraryManager: LibraryManager;
    spaceName: string = "";
    isGitInit: boolean = true;
    publishToGitHub: boolean = false;
    isPrivate: boolean = true;

    constructor(app: App, plugin: AbstractFolderPlugin) {
        super(app);
        this.plugin = plugin;
        this.libraryManager = plugin.libraryManager;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl("h2", { text: "Create New Shared Space" });
        contentEl.createEl("p", { text: "Create a collaborative space backed by Git. This will create a local folder and initialize a repository." });

        new Setting(contentEl)
            .setName("Space Name")
            .setDesc("The name of your project or team space")
            .addText((text) =>
                text
                    .setPlaceholder("Project Alpha")
                    .onChange((value) => {
                        this.spaceName = value;
                    })
            );

        new Setting(contentEl)
            .setName("Initialize Git Repository")
            .setDesc("Initialize a new Git repository in this folder")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.isGitInit)
                    .onChange((value) => {
                        this.isGitInit = value;
                        this.renderSettings();
                    })
            );

        this.settingsContainer = contentEl.createDiv();
        this.renderSettings();

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Create Space")
                    .setCta()
                    .onClick(async () => {
                        if (!this.spaceName) {
                            new Notice("Please enter a space name");
                            return;
                        }
                        
                        btn.setDisabled(true);
                        btn.setButtonText("Creating...");
                        
                        try {
                            await this.createSpace();
                            this.close();
                        } catch (e) {
                            new Notice(`Failed to create space: ${e.message}`);
                            btn.setDisabled(false);
                            btn.setButtonText("Create Space");
                        }
                    })
            );
    }

    private settingsContainer: HTMLElement;

    private renderSettings() {
        this.settingsContainer.empty();

        if (this.isGitInit) {
            new Setting(this.settingsContainer)
                .setName("Publish to GitHub")
                .setDesc("Automatically create a repository and push this space to GitHub")
                .addToggle((toggle) =>
                    toggle
                        .setValue(this.publishToGitHub)
                        .onChange((value) => {
                            this.publishToGitHub = value;
                            this.renderSettings();
                        })
                );

            if (this.publishToGitHub) {
                new Setting(this.settingsContainer)
                    .setName("Private Repository")
                    .setDesc("If disabled, the repository will be public")
                    .addToggle((toggle) =>
                        toggle
                            .setValue(this.isPrivate)
                            .onChange((value) => {
                                this.isPrivate = value;
                            })
                    );
            }
        }
    }

    async createSpace() {
        const spacesRoot = this.plugin.settings.librarySettings.sharedSpacesRoot || "Abstract Spaces";
        const path = `${spacesRoot}/${this.spaceName}`;

        // 1. Create Folder
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

            await this.app.vault.createFolder(path);
            new Notice(`Created folder: ${path}`);
            
            // 2. Add to Shared Spaces List (if not already there)
            if (!this.plugin.settings.librarySettings.sharedSpaces) {
                this.plugin.settings.librarySettings.sharedSpaces = [];
            }
            if (!this.plugin.settings.librarySettings.sharedSpaces.includes(path)) {
                this.plugin.settings.librarySettings.sharedSpaces.push(path);
                await this.plugin.saveSettings();
            }

            // 3. Initialize Git
            if (this.isGitInit) {
                try {
                    await this.libraryManager.initRepository(path);
                    
                    if (this.publishToGitHub) {
                        const token = await this.libraryManager.getToken();
                        if (!token) {
                            new Notice("GitHub token missing. Space created locally, but failed to publish.");
                        } else {
                            // Ensure credentials are ready before publishing
                            await this.libraryManager.getAuthorCredentials();
                            
                            const repoName = this.spaceName.toLowerCase().replace(/\s+/g, '-');
                            
                            new Notice(`Creating repository "${repoName}"...`);
                            const repo = await AuthService.createRepository(token, repoName, this.isPrivate);
                            
                            if (repo) {
                                await this.libraryManager.addRemote(path, repo.url);
                                new Notice("Performing initial sync...");
                                await this.libraryManager.syncBackup(path, "Initial publish to GitHub", undefined, true);
                                new Notice("Successfully published to GitHub!");
                            } else {
                                new Notice("Failed to create GitHub repository. Space is local-only.");
                            }
                        }
                    }

                    // Start sync engine immediately
                    await this.libraryManager.startSyncEngine(path);
                    new Notice("Sync engine active for new space");
                    
                    // visual refresh
                    this.plugin.graphEngine.forceReindex();

                } catch (e) {
                    console.error("Failed to init git", e);
                    new Notice("Folder created, but Git initialization failed. Check console.");
                }
            }

            // Trigger view update
            this.app.workspace.trigger("abstract-folder:spaces-updated");

        } catch (e) {
            new Notice("Failed to create space: " + e.message);
            console.error(e);
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
