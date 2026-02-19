import { App, Setting, Notice, setIcon, ButtonComponent, TFolder, moment } from "obsidian";
import AbstractFolderPlugin from "main";
import { CollaboratorView } from "./collaborator-view";

export class UnifiedDashboardView {
    private collaboratorView: CollaboratorView;
    private hasGit: boolean = false;
    private isScanning: boolean = false;
    private largeFiles: string[] = [];

    constructor(
        private containerEl: HTMLElement,
        private app: App,
        private plugin: AbstractFolderPlugin,
        private vaultPath: string,
        private isOwner: boolean,
        private name: string,
        private onClose: () => void
    ) {
        this.init();
    }

    private async init() {
        this.hasGit = await this.plugin.libraryManager.detectExistingGit(this.vaultPath);
        this.render();
    }

    private render() {
        this.containerEl.empty();
        const container = this.containerEl.createDiv({ cls: "af-dashboard-container" });

        if (!this.hasGit) {
            this.renderSetupGuide(container);
            this.renderGovernanceSection(container);
            return;
        }

        // Collaboration Section
        const collabContainer = container.createDiv({ cls: "af-dashboard-section-wrapper" });
        this.collaboratorView = new CollaboratorView(
            collabContainer,
            this.app,
            this.plugin,
            this.vaultPath,
            this.isOwner
        );

        // Sync Section
        this.renderSyncSection(container);
        
        // Activity Section
        this.renderActivitySection(container);
        
        // Governance/Security
        this.renderGovernanceSection(container);
    }

    private renderSetupGuide(container: HTMLElement) {
        const section = container.createDiv({ cls: "af-dashboard-section" });
        section.createEl("h3", { text: "Setup Repository" });
        section.createEl("p", { text: "This folder isn't connected to a GitHub repository yet. Connect it to enable cloud sync and collaboration." });

        let repoName = this.name.toLowerCase().replace(/\s+/g, '-');
        let isPrivate = true;

        new Setting(section)
            .setName("Repository name")
            .addText(text => text
                .setValue(repoName)
                .onChange(val => repoName = val));

        new Setting(section)
            .setName("Private repository")
            .addToggle(toggle => toggle
                .setValue(isPrivate)
                .onChange(val => isPrivate = val));

        new Setting(section)
            .addButton(btn => btn
                .setButtonText("Initialize Backup")
                .setCta()
                .onClick(async () => {
                    const token = this.plugin.settings.librarySettings.githubToken;
                    if (!token) {
                        new Notice("GitHub PAT not found. Please configure it in settings.");
                        return;
                    }
                    btn.setDisabled(true);
                    btn.setButtonText("Creating...");
                    
                    const { AuthService } = await import("../../library/services/auth-service");
                    const repoData = await AuthService.createRepository(token, repoName, isPrivate);
                    if (repoData) {
                        await this.plugin.libraryManager.initializePersonalBackup(this.vaultPath, repoData.url, token);
                        new Notice("Repository initialized!");
                        this.init(); // Refresh
                    } else {
                        new Notice("Failed to create repository.");
                        btn.setDisabled(false);
                        btn.setButtonText("Initialize Backup");
                    }
                }));
    }

    private getConfig() {
        if (!this.plugin.settings.librarySettings.spaceConfigs) {
            this.plugin.settings.librarySettings.spaceConfigs = {};
        }
        if (!this.plugin.settings.librarySettings.spaceConfigs[this.vaultPath]) {
            this.plugin.settings.librarySettings.spaceConfigs[this.vaultPath] = {
                path: this.vaultPath,
                enableScheduledSync: false,
                syncIntervalValue: 1,
                syncIntervalUnit: 'hours'
            };
        }
        return this.plugin.settings.librarySettings.spaceConfigs[this.vaultPath];
    }

    private renderSyncSection(container: HTMLElement) {
        const section = container.createDiv({ cls: "af-dashboard-section" });
        section.createEl("h3", { text: "Sync Settings" });

        const config = this.getConfig();

        new Setting(section)
            .setName("Sync Changes Now")
            .setDesc("Push and pull updates manually.")
            .addButton(btn => btn
                .setButtonText("Sync Now")
                .onClick(async () => {
                    btn.setDisabled(true);
                    btn.setButtonText("Syncing...");
                    try {
                        await this.plugin.libraryManager.syncBackup(this.vaultPath);
                        new Notice("Sync complete");
                        this.onClose();
                    } catch (e) {
                        new Notice(`Sync failed: ${e.message}`);
                        btn.setDisabled(false);
                        btn.setButtonText("Sync Now");
                    }
                }));

        new Setting(section)
            .setName("Enable scheduled sync")
            .addToggle((toggle) =>
                toggle
                    .setValue(config.enableScheduledSync)
                    .onChange(async (value) => {
                        config.enableScheduledSync = value;
                        await this.plugin.saveSettings();
                        this.plugin.setupSyncScheduler();
                    }),
            );

        new Setting(section)
            .setName("Sync interval")
            .addText((text) =>
                text
                    .setPlaceholder("1")
                    .setValue(String(config.syncIntervalValue))
                    .onChange(async (value) => {
                        const num = parseInt(value);
                        if (!isNaN(num) && num > 0) {
                            config.syncIntervalValue = num;
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
                    .setValue(config.syncIntervalUnit)
                    .onChange(async (value: any) => {
                        config.syncIntervalUnit = value;
                        await this.plugin.saveSettings();
                        this.plugin.setupSyncScheduler();
                    }),
            );
    }

    private async renderActivitySection(container: HTMLElement) {
        const section = container.createDiv({ cls: "af-dashboard-section" });
        section.createEl("h3", { text: "Recent Activity" });

        const history = await this.plugin.libraryManager.getHistory(this.vaultPath, 5);
        if (history.length === 0) {
            section.createEl("p", { text: "No sync activity yet.", cls: "af-empty-state" });
            return;
        }

        const list = section.createDiv({ cls: "af-activity-list" });
        history.forEach(commit => {
            const item = list.createDiv({ cls: "af-activity-item" });
            item.createDiv({ cls: "af-activity-dot" });
            const content = item.createDiv({ cls: "af-activity-content" });
            const header = content.createDiv({ cls: "af-activity-header" });
            header.createSpan({ cls: "af-activity-author", text: commit.author });
            header.createSpan({ cls: "af-activity-date", text: moment(commit.timestamp).fromNow() });
            content.createDiv({ cls: "af-activity-msg", text: commit.message });
        });
    }

    private renderGovernanceSection(container: HTMLElement) {
        const section = container.createDiv({ cls: "af-dashboard-section" });
        section.createEl("h3", { text: "Exclusions & Health" });

        const exclusions = this.plugin.settings.librarySettings.securityExclusions || [];
        section.createEl("p", { 
            text: `Automatically ignored: ${exclusions.join(", ") || "none"}`,
            cls: "af-dashboard-exclusions-text" 
        });

        if (this.hasGit) {
            new Setting(section)
                .setName("Scan Large Files")
                .addButton(btn => btn
                    .setButtonText(this.isScanning ? "Scanning..." : "Scan Now")
                    .onClick(async () => {
                        this.isScanning = true;
                        this.render();
                        this.largeFiles = await this.plugin.libraryManager.checkForLargeFiles(this.vaultPath);
                        this.isScanning = false;
                        this.render();
                        if (this.largeFiles.length > 0) {
                            new Notice(`Found ${this.largeFiles.length} large files.`);
                        } else {
                            new Notice("No large files found.");
                        }
                    }));

            if (this.largeFiles.length > 0) {
                const list = section.createDiv({ cls: "af-warning-list" });
                this.largeFiles.slice(0, 3).forEach(f => list.createDiv({ text: `⚠️ ${f}`, cls: "af-warning-file" }));
            }
        }
    }
}
