import { Modal, App, Setting, TFolder, Notice } from "obsidian";
import type AbstractFolderPlugin from "../../../main";
import { AuthService } from "../../library/services/auth-service";

export class PersonalBackupModal extends Modal {
    private repoName: string;
    private isPrivate: boolean = true;
    private folder: TFolder;
    private hasGit: boolean = false;
    private isScanning: boolean = false;
    private largeFiles: string[] = [];

    constructor(app: App, private plugin: AbstractFolderPlugin, folder: TFolder) {
        super(app);
        this.modalEl.addClass("af-backup-modal");
        this.folder = folder;
        const vaultName = (app.vault.adapter as any).getName?.() || "my-vault";
        this.repoName = folder.path === "" ? vaultName.toLowerCase().replace(/\s+/g, '-') : folder.name.toLowerCase().replace(/\s+/g, '-');
    }

    async onOpen() {
        this.hasGit = await this.plugin.libraryManager.detectExistingGit(this.folder.path);
        this.display();
    }

    private display() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("abstract-folder-backup-center");

        contentEl.createEl("h2", { text: "Backup & Sync Center" });

        if (this.hasGit) {
            this.renderSyncDashboard(contentEl);
        } else {
            this.renderSetupGuide(contentEl);
        }

        this.renderGovernanceSection(contentEl);
    }

    private renderSyncDashboard(container: HTMLElement) {
        container.createEl("p", { text: "Your vault is linked to GitHub. Keep your personal notes and structure in sync with one click." });
        
        const statusBox = container.createDiv({ cls: "abstract-folder-status-box" });
        statusBox.createEl("div", { text: "✓ Git Initialized", cls: "status-tag success" });

        new Setting(container)
            .setName("Sync Changes")
            .setDesc("Push your latest local changes to GitHub and pull any remote updates.")
            .addButton(btn => btn
                .setButtonText("Sync Now")
                .setCta()
                .onClick(async () => {
                    btn.setDisabled(true);
                    btn.setButtonText("Syncing...");
                    try {
                        await this.plugin.libraryManager.syncBackup(this.folder.path);
                        this.close();
                    } catch (e) {
                        new Notice(`Sync failed: ${e.message}`);
                        this.display();
                    }
                }));

        container.createEl("hr");
        container.createEl("h3", { text: "Scheduled Sync" });

        new Setting(container)
            .setName("Enable scheduled sync")
            .setDesc("Automatically sync your personal backup at regular intervals.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.librarySettings.enableScheduledSync)
                    .onChange(async (value) => {
                        this.plugin.settings.librarySettings.enableScheduledSync = value;
                        await this.plugin.saveSettings();
                        this.plugin.setupSyncScheduler();
                    }),
            );

        new Setting(container)
            .setName("Sync interval")
            .setDesc("How often to perform an automatic sync.")
            .addText((text) =>
                text
                    .setPlaceholder("1")
                    .setValue(String(this.plugin.settings.librarySettings.syncIntervalValue))
                    .onChange(async (value) => {
                        const num = parseInt(value);
                        if (!isNaN(num) && num > 0) {
                            this.plugin.settings.librarySettings.syncIntervalValue = num;
                            await this.plugin.saveSettings();
                            this.plugin.setupSyncScheduler();
                        }
                    }),
            )
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("minutes", "Minutes")
                    .addOption("hours", "Hours")
                    .addOption("days", "Days")
                    .addOption("weeks", "Weeks")
                    .setValue(this.plugin.settings.librarySettings.syncIntervalUnit)
                    .onChange(async (value: "minutes" | "hours" | "days" | "weeks") => {
                        this.plugin.settings.librarySettings.syncIntervalUnit = value;
                        await this.plugin.saveSettings();
                        this.plugin.setupSyncScheduler();
                    }),
            );
    }

    private renderSetupGuide(container: HTMLElement) {
        container.createEl("p", { text: "It looks like this vault isn't backed up to GitHub yet. Let's set it up!" });

        if (this.folder.path === "") {
            const infoEl = container.createDiv({ cls: "abstract-folder-info-box" });
            infoEl.createEl("strong", { text: "Scope: Entire Vault Root" });
            infoEl.createEl("p", { text: "This will track all your personal notes. Don't worry, your managed libraries and private settings will be excluded automatically." });
        }

        new Setting(container)
            .setName("Repository name")
            .setDesc("The name for your new GitHub repository.")
            .addText(text => text
                .setValue(this.repoName)
                .onChange(value => this.repoName = value));

        new Setting(container)
            .setName("Private repository")
            .setDesc("Only you can see private repositories.")
            .addToggle(toggle => toggle
                .setValue(this.isPrivate)
                .onChange(value => this.isPrivate = value));

        new Setting(container)
            .addButton(btn => btn
                .setButtonText("Initialize Backup")
                .setCta()
                .onClick(() => this.startBackup()));
    }

    private renderGovernanceSection(container: HTMLElement) {
        container.createEl("hr");
        container.createEl("h3", { text: "Safety & Exclusions" });

        const librariesPath = this.plugin.settings.librarySettings?.librariesPath || "Abstract Library";
        const exclusions = [librariesPath, ".obsidian", ".trash", "node_modules"].map(e => `• ${e}`).join("\n");
        
        container.createEl("p", { text: "The following paths are automatically ignored to keep your backup clean and secure:" });
        container.createEl("pre", { text: exclusions, cls: "abstract-folder-exclusion-list" });

        const scanSetting = new Setting(container)
            .setName("Large File Audit")
            .setDesc("Scan for files > 10MB that might cause sync issues.");

        if (this.largeFiles.length > 0) {
            const warningEl = container.createDiv({ cls: "abstract-folder-warning-list" });
            warningEl.createEl("strong", { text: `Found ${this.largeFiles.length} large files:` });
            const list = warningEl.createEl("ul");
            this.largeFiles.slice(0, 5).forEach(f => list.createEl("li", { text: f }));
            if (this.largeFiles.length > 5) list.createEl("li", { text: "...and more." });
        }

        scanSetting.addButton(btn => btn
            .setButtonText(this.isScanning ? "Scanning..." : (this.largeFiles.length > 0 ? "Re-scan" : "Scan Now"))
            .setDisabled(this.isScanning)
            .onClick(async () => {
                this.isScanning = true;
                this.display();
                this.largeFiles = await this.plugin.libraryManager.checkForLargeFiles(this.folder.path);
                this.isScanning = false;
                this.display();
            }));
    }

    private async startBackup() {
        if (!this.repoName) {
            new Notice("Repository name is required.");
            return;
        }

        const token = this.plugin.settings.librarySettings.githubToken;
        if (!token) {
            new Notice("GitHub PAT not found. Please configure it in settings.");
            return;
        }

        this.close();
        new Notice("Creating repository and initializing backup...");

        try {
            const repoData = await AuthService.createRepository(token, this.repoName, this.isPrivate);
            if (!repoData) {
                new Notice("Failed to create repository on GitHub.");
                return;
            }

            await this.plugin.libraryManager.initializePersonalBackup(this.folder.path, repoData.url, token);
        } catch (error) {
            new Notice(`Backup failed: ${error.message}`);
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
