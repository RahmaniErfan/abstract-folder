
import { App, Modal, Setting, Notice, TFolder } from "obsidian";
import AbstractFolderPlugin from "main";
import { LibraryManager } from "../../library/git/library-manager";

export class CreateSharedSpaceModal extends Modal {
    plugin: AbstractFolderPlugin;
    libraryManager: LibraryManager;
    spaceName: string = "";
    isGitInit: boolean = true;

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
                    })
            );

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
                        await this.createSpace();
                        this.close();
                    })
            );
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
                    // We need the adapter to perform git init
                    // LibraryManager doesn't expose a direct 'init' method for arbitrary folders easily,
                    // but we can use the simple-git interface or the adapter directly if exposed.
                    // For now, let's try to ask LibraryManager to "initializeLibrary" which might do similarly.
                    // Or better, just use the file system adapter.
                    
                    // Since specific git command access is limited, let's reuse logic from LibraryManager if available,
                    // or implement a basic init. 
                    // Let's assume LibraryManager has a `initRepository(path)` method or we add one.
                    await this.libraryManager.initRepository(path);
                    new Notice("Git repository initialized");
                    
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
