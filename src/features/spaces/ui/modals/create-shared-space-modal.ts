
import { App, Modal, Setting, Notice, TFolder } from "obsidian";
import AbstractFolderPlugin from "main";
import { LibraryManager } from "../../../../core/git/library-manager";
import { AuthService } from "../../../../core/git/manager/auth-service";

export class CreateSharedSpaceModal extends Modal {
    plugin: AbstractFolderPlugin;
    libraryManager: LibraryManager;
    spaceName: string = "";
    isGitInit: boolean = true;
    publishToGitHub: boolean = true;
    isPrivate: boolean = true;
    spaceType: 'shared' | 'library' = 'shared';

    constructor(app: App, plugin: AbstractFolderPlugin) {
        super(app);
        this.plugin = plugin;
        this.libraryManager = plugin.libraryManager;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl("h2", { text: "Create and Publish Space" });
        contentEl.createEl("p", { 
            text: "Create a collaborative space backed by Git and hosted on GitHub. You can create a Shared Space for team collaboration, or a Library Space to build templates for the Abstract Catalog.",
            cls: "af-modal-description"
        });

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
            .setName("Space Type")
            .setDesc("Choose 'Shared Space' for personal or team collaboration, or 'Library Space' to create and share your own templates in the Abstract Library Catalog.")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("shared", "Shared Space")
                    .addOption("library", "Library Space")
                    .setValue(this.spaceType)
                    .onChange((value: 'shared' | 'library') => {
                        this.spaceType = value;
                        if (value === 'library') {
                            this.publishToGitHub = true;
                        }
                        this.renderSettings();
                    })
            )
            .addButton((btn) => 
                btn
                    .setIcon("info")
                    .setTooltip("About Space Types")
                    .onClick(() => {
                        const { SpacesInfoModal } = require("../modals/spaces-info-modal");
                        new SpacesInfoModal(this.app).open();
                    })
            );

        this.settingsContainer = contentEl.createDiv();
        this.renderSettings();

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Create and Publish to GitHub")
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

        if (this.spaceType === 'library') {
            const template = this.plugin.settings.library.libraryTemplateRepo;
            new Setting(this.settingsContainer)
                .setName("Library Template")
                .setDesc(`This library will be initialized from: ${template}`)
                .setDisabled(true);
        }

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

    async createSpace() {
        const spacesRoot = this.plugin.settings.spaces.sharedSpacesRoot || "Abstract Spaces";
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
            if (!this.plugin.settings.spaces.sharedSpaces) {
                this.plugin.settings.spaces.sharedSpaces = [];
            }
            if (!this.plugin.settings.spaces.sharedSpaces.includes(path)) {
                this.plugin.settings.spaces.sharedSpaces.push(path);
                
                // Initialize space config
                if (!this.plugin.settings.spaces.spaceConfigs[path]) {
                    this.plugin.settings.spaces.spaceConfigs[path] = {
                        path: path,
                        enableScheduledSync: this.plugin.settings.git.enableScheduledSync,
                        syncIntervalValue: this.plugin.settings.git.syncIntervalValue,
                        syncIntervalUnit: this.plugin.settings.git.syncIntervalUnit,
                        spaceType: this.spaceType
                    };
                }

                await this.plugin.saveSettings();
            }

            // 3. Initialize Git
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
                        
                        let repo;
                        if (this.spaceType === 'library') {
                            const templatePath = this.plugin.settings.library.libraryTemplateRepo;
                            const [owner, name] = templatePath.split('/');
                            repo = await AuthService.createRepositoryFromTemplate(token, owner, name, repoName, this.isPrivate);
                        } else {
                            repo = await AuthService.createRepository(token, repoName, this.isPrivate);
                        }
                        
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
