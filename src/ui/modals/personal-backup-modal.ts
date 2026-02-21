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

        contentEl.createEl("h2", { text: "Vault Sharing & Sync Center" });

        if (this.hasGit) {
            this.renderSyncDashboard(contentEl);
            this.renderSharingSection(contentEl);
        } else {
            this.renderSetupGuide(contentEl);
        }

        this.renderGovernanceSection(contentEl);
    }

    private renderSyncDashboard(container: HTMLElement) {
        container.createEl("p", { text: "Keep this vault segment in sync across your devices or with collaborators." });
        
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

    private async renderSharingSection(container: HTMLElement) {
        container.createEl("hr");
        container.createEl("h3", { text: "Vault Sharing" });
        container.createEl("p", { text: "To share this vault with others, you need to grant them access to the underlying GitHub repository." });

        const remoteUrl = await this.plugin.libraryManager.getRemoteUrl(this.folder.path);
        if (remoteUrl) {
            // Sanitize URL: Remove credentials and convert to standard HTTPS if possible
            let githubUrl = remoteUrl;
            try {
                if (githubUrl.includes('@') && githubUrl.includes('github.com')) {
                    if (githubUrl.startsWith('git@')) {
                        githubUrl = githubUrl.replace('git@github.com:', 'https://github.com/').replace('.git', '');
                    } else {
                        const urlObj = new URL(githubUrl);
                        githubUrl = `https://${urlObj.host}${urlObj.pathname.replace('.git', '')}`;
                    }
                }
            } catch (e) {
                console.warn("[PersonalBackupModal] Failed to sanitize URL", e);
            }
            
            const shareBox = container.createDiv({ cls: "af-share-box" });
            const shareHeader = shareBox.createDiv({ cls: "af-share-header" });
            shareHeader.createEl("strong", { text: "Repository Link" });
            
            const copyBtn = shareHeader.createEl("button", { 
                text: "Copy Link", 
                cls: "mod-small" 
            });
            copyBtn.addEventListener("click", () => {
                navigator.clipboard.writeText(githubUrl).then(() => {
                    const originalText = copyBtn.innerText;
                    copyBtn.innerText = "Copied!";
                    copyBtn.addClass("is-success");
                    setTimeout(() => {
                        copyBtn.innerText = originalText;
                        copyBtn.removeClass("is-success");
                    }, 2000);
                });
            });

            const linkContainer = shareBox.createDiv({ cls: "af-share-link-container" });
            linkContainer.createEl("code", { text: githubUrl, cls: "af-share-link-code" });

            const infoEl = container.createDiv({ cls: "af-share-flow-info" });
            infoEl.createEl("p", { 
                text: "1. Add your collaborator to this repository on GitHub (Settings > Collaborators)." 
            });
            infoEl.createEl("p", { 
                text: "2. Send them the link above." 
            });
            infoEl.createEl("p", { 
                text: "3. They can then add this link as a 'Standalone Library' in their Abstract Folder settings to start syncing with you." 
            });
        }
    }

    private renderGovernanceSection(container: HTMLElement) {
        container.createEl("hr");
        container.createEl("h3", { text: "Security & Exclusions" });

        const exclusions = this.plugin.settings.librarySettings.securityExclusions || [];
        const exclusionText = exclusions.map(e => `• ${e}`).join("\n");
        
        container.createEl("p", { text: "The following patterns are automatically ignored to keep your vault clean and secure:" });
        container.createEl("pre", { text: exclusionText, cls: "abstract-folder-exclusion-list" });

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

        const token = await this.plugin.libraryManager.getToken();
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
